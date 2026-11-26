import { Injectable, Injector, inject } from '@angular/core';
import {
  CatalogBundleMeta,
  CatalogManifest,
  ColorDetails,
  ColorSummary,
  ModelRecipe,
  ModelSummary,
  Paint,
} from '../models/catalog.models';
import {
  normalizeColorDetails,
  normalizeModelRecipe,
  synthesizeColorDetails,
  synthesizeModelRecipe,
} from '../utils/catalog-normalizer.util';
import { createIdbStoreClient } from '../utils/idb.util';
import { isSafeRecordKey } from '../utils/user-state-normalizer.util';
import { getFirebaseFirestore } from './firebase.config';
import { WarhammerImportService } from './warhammer-import.service';

export const CATALOG_IDB_NAME = 'whc_catalog_cache_v1';
export const CATALOG_IDB_VERSION = 1;
export const STORE_BUNDLES = 'bundles';
export const STORE_RECIPES = 'recipes';
export const STORE_COLORS = 'colors';

const SAFE_ENTITY_ID_RE = /^[a-zA-Z0-9_-]+$/;
const MODEL_BUNDLE_PREFIX = 'models_index_';
const MAX_FIRESTORE_DOC_BYTES = 950_000;

@Injectable({
  providedIn: 'root',
})
export class CatalogRepository {
  private readonly injector = inject(Injector);
  private readonly idb = createIdbStoreClient(CATALOG_IDB_NAME, CATALOG_IDB_VERSION, [
    STORE_BUNDLES,
    STORE_RECIPES,
    STORE_COLORS,
  ]);
  private readonly inFlightEntities = new Map<string, Promise<unknown>>();

  protected getFirestoreHandle() {
    return getFirebaseFirestore();
  }

  protected getCachedBearerToken(): string | null {
    return this.injector.get(WarhammerImportService, null)?.getCachedBearerToken() ?? null;
  }

  getCachedManifest(): Promise<CatalogManifest | null> {
    return this.idb.get<CatalogManifest>(STORE_BUNDLES, 'manifest');
  }

  clearAllCache(): Promise<void> {
    return this.idb.clearAll();
  }

  async clearEntityCaches(): Promise<void> {
    await Promise.all([
      this.idb.clearStore(STORE_RECIPES),
      this.idb.clearStore(STORE_COLORS),
    ]);
  }

  getValidBundlesMap(rawBundles: unknown): Record<string, CatalogBundleMeta | string> {
    if (!rawBundles || typeof rawBundles !== 'object' || Array.isArray(rawBundles)) {
      return {};
    }
    return rawBundles as Record<string, CatalogBundleMeta | string>;
  }

  findStaleBundles(
    remoteManifest: CatalogManifest,
    cachedManifest: CatalogManifest | null
  ): string[] {
    const staleBundles: string[] = [];
    const remoteBundles = this.getValidBundlesMap(remoteManifest.bundles);
    const rawCachedBundles = cachedManifest?.bundles;
    const hasValidCachedBundles =
      typeof rawCachedBundles === 'object' &&
      rawCachedBundles !== null &&
      !Array.isArray(rawCachedBundles);
    const cachedBundles = hasValidCachedBundles
      ? (rawCachedBundles as Record<string, CatalogBundleMeta | string>)
      : null;

    for (const bundleId of Object.keys(remoteBundles)) {
      if (!isSafeRecordKey(bundleId)) {
        continue;
      }
      const remoteEntry = remoteBundles[bundleId];
      const localEntry =
        cachedBundles && Object.hasOwn(cachedBundles, bundleId)
          ? cachedBundles[bundleId]
          : undefined;
      const remoteHash = typeof remoteEntry === 'string' ? remoteEntry : remoteEntry?.hash;
      const localHash = typeof localEntry === 'string' ? localEntry : localEntry?.hash;
      if (!cachedManifest || !cachedBundles || remoteHash !== localHash) {
        staleBundles.push(bundleId);
      }
    }
    return staleBundles;
  }

  getModelBundleKeys(manifest: CatalogManifest): string[] {
    return Object.keys(this.getValidBundlesMap(manifest.bundles))
      .filter((key) => isSafeRecordKey(key) && key.startsWith(MODEL_BUNDLE_PREFIX))
      .sort((a, b) => {
        const numA = Number.parseInt(a.slice(MODEL_BUNDLE_PREFIX.length), 10);
        const numB = Number.parseInt(b.slice(MODEL_BUNDLE_PREFIX.length), 10);
        if (Number.isFinite(numA) && Number.isFinite(numB)) {
          return numA - numB;
        }
        return a.localeCompare(b);
      });
  }

  isStaticOnlyMetaDoc(docId: string, manifestMeta?: CatalogBundleMeta | string): boolean {
    if (docId.startsWith(MODEL_BUNDLE_PREFIX)) {
      return true;
    }
    return (
      typeof manifestMeta === 'object' &&
      manifestMeta !== null &&
      (manifestMeta.staticOnly === true ||
        (typeof manifestMeta.sizeBytes === 'number' &&
          manifestMeta.sizeBytes > MAX_FIRESTORE_DOC_BYTES))
    );
  }

  async fetchMetaDoc<T>(docId: string, manifestMeta?: CatalogBundleMeta | string): Promise<T> {
    if (!this.isStaticOnlyMetaDoc(docId, manifestMeta)) {
      const fb = await this.getFirestoreHandle();
      if (fb) {
        try {
          const snap = await fb.getDoc(fb.doc(fb.db, 'catalog_meta', docId));
          if (snap.exists()) {
            return snap.data() as T;
          }
        } catch (err) {
          console.warn(
            `Firestore catalog_meta/${docId} fetch failed, falling back to static bundle:`,
            err
          );
        }
      }
    }
    const resp = await fetch(`/data/catalog_meta/${docId}.json`, { cache: 'no-cache' });
    if (!resp.ok) {
      throw new Error(`Failed to load /data/catalog_meta/${docId}.json: ${resp.status}`);
    }
    return (await resp.json()) as T;
  }

  async readBundlesBatch(
    bundleIds: readonly string[],
    inMemoryBundles?: ReadonlyMap<string, unknown>
  ): Promise<{ bundles: Map<string, unknown>; presentIds: Set<string> }> {
    const bundles = new Map<string, unknown>();
    const presentIds = new Set<string>();
    const keysToRead: string[] = [];

    for (const bundleId of bundleIds) {
      if (inMemoryBundles?.has(bundleId)) {
        const inMemory = inMemoryBundles.get(bundleId);
        if (inMemory !== null && inMemory !== undefined) {
          bundles.set(bundleId, inMemory);
          presentIds.add(bundleId);
          continue;
        }
      }
      keysToRead.push(bundleId);
    }

    if (keysToRead.length > 0) {
      const fromIdb = await this.idb.getMany<unknown>(STORE_BUNDLES, keysToRead);
      for (const [key, value] of fromIdb.entries()) {
        if (value !== null && value !== undefined) {
          bundles.set(key, value);
          presentIds.add(key);
        }
      }
    }

    return { bundles, presentIds };
  }

  async findMissingBundleIds(
    remoteBundles: Record<string, CatalogBundleMeta | string>,
    staleSet: ReadonlySet<string>,
    checkedIds: ReadonlySet<string>,
    presentIds: Set<string>
  ): Promise<string[]> {
    const missingCheckedBundles: string[] = [];
    const uncheckedIds: string[] = [];

    for (const bundleId of Object.keys(remoteBundles)) {
      if (!isSafeRecordKey(bundleId) || staleSet.has(bundleId)) {
        continue;
      }
      if (checkedIds.has(bundleId)) {
        if (!presentIds.has(bundleId)) {
          missingCheckedBundles.push(bundleId);
        }
      } else {
        uncheckedIds.push(bundleId);
      }
    }

    if (uncheckedIds.length > 0) {
      const fromIdb = await this.idb.getMany<unknown>(STORE_BUNDLES, uncheckedIds);
      for (const bundleId of uncheckedIds) {
        const existing = fromIdb.get(bundleId);
        if (existing === null || existing === undefined) {
          missingCheckedBundles.push(bundleId);
        } else {
          presentIds.add(bundleId);
        }
      }
    }

    return missingCheckedBundles;
  }

  async fetchAndPersistBundles(
    bundlesToFetch: readonly string[],
    remoteManifest: CatalogManifest,
    cachedManifest: CatalogManifest | null,
    presentIds: ReadonlySet<string>
  ): Promise<Map<string, unknown>> {
    const remoteBundles = this.getValidBundlesMap(remoteManifest.bundles);
    const bundlesToFetchSet = new Set(bundlesToFetch);
    const fetchedBundles = new Map<string, unknown>();
    const persistedBundleIds = new Set<string>();

    await Promise.all(
      bundlesToFetch.map(async (bundleId) => {
        const data = await this.fetchMetaDoc<unknown>(bundleId, remoteBundles[bundleId]);
        fetchedBundles.set(bundleId, data);
        try {
          await this.idb.put(STORE_BUNDLES, bundleId, data);
          persistedBundleIds.add(bundleId);
        } catch (putErr) {
          console.warn(`Failed to cache catalog bundle ${bundleId} in IndexedDB:`, putErr);
        }
      })
    );

    const cachedBundles = this.getValidBundlesMap(cachedManifest?.bundles);
    const manifestBundlesToCache: Record<string, CatalogBundleMeta | string> = {};
    for (const bundleId of Object.keys(remoteBundles)) {
      if (!isSafeRecordKey(bundleId)) {
        continue;
      }
      if (!bundlesToFetchSet.has(bundleId) || persistedBundleIds.has(bundleId)) {
        Object.defineProperty(manifestBundlesToCache, bundleId, {
          value: remoteBundles[bundleId],
          enumerable: true,
          configurable: true,
          writable: true,
        });
      } else if (Object.hasOwn(cachedBundles, bundleId) && presentIds.has(bundleId)) {
        Object.defineProperty(manifestBundlesToCache, bundleId, {
          value: cachedBundles[bundleId],
          enumerable: true,
          configurable: true,
          writable: true,
        });
      }
    }

    const manifestToCache: CatalogManifest = {
      ...remoteManifest,
      bundles: manifestBundlesToCache,
    };
    try {
      await this.idb.put(STORE_BUNDLES, 'manifest', manifestToCache);
    } catch (putErr) {
      console.warn('Failed to cache catalog manifest in IndexedDB:', putErr);
    }

    return fetchedBundles;
  }

  getModelRecipe(
    recipeId: string,
    summary: ModelSummary | undefined,
    colorMap: ReadonlyMap<string, ColorSummary>,
    paintMap: ReadonlyMap<string, Paint>
  ): Promise<ModelRecipe | null> {
    return this.getOrDedupeInFlight(`recipes:${recipeId}`, () =>
      this.getCachedOrRemoteEntity<ModelRecipe, ModelSummary>({
        storeName: STORE_RECIPES,
        collectionName: 'recipes',
        id: recipeId,
        summary,
        normalizeRemote: (rawDoc, s) => normalizeModelRecipe(rawDoc, colorMap, paintMap, s),
        synthesize: (s) => synthesizeModelRecipe(s, colorMap, paintMap),
      })
    );
  }

  getColorDetails(
    colorId: string,
    summary: ColorSummary | undefined,
    paintMap: ReadonlyMap<string, Paint>
  ): Promise<ColorDetails | null> {
    return this.getOrDedupeInFlight(`colours:${colorId}`, () =>
      this.getCachedOrRemoteEntity<ColorDetails, ColorSummary>({
        storeName: STORE_COLORS,
        collectionName: 'colours',
        id: colorId,
        summary,
        normalizeRemote: (rawDoc, s) => normalizeColorDetails(rawDoc, paintMap, s),
        synthesize: (s) => synthesizeColorDetails(s, paintMap),
      })
    );
  }

  private getOrDedupeInFlight<T>(key: string, factory: () => Promise<T>): Promise<T> {
    const existing = this.inFlightEntities.get(key) as Promise<T> | undefined;
    if (existing) {
      return existing;
    }
    const promise = factory().finally(() => {
      if (this.inFlightEntities.get(key) === promise) {
        this.inFlightEntities.delete(key);
      }
    });
    this.inFlightEntities.set(key, promise);
    return promise;
  }

  private async tryFetchAndCacheEntity<T>(
    url: string,
    storeName: string,
    id: string,
    normalizeRemote: (raw: Record<string, unknown>) => T,
    init?: RequestInit
  ): Promise<T | null> {
    try {
      const resp = await fetch(url, init);
      const contentType = (resp.headers.get('content-type') ?? '').toLowerCase();
      if (!resp.ok || !contentType.includes('application/json')) {
        return null;
      }
      const raw = (await resp.json()) as Record<string, unknown> | null;
      if (!raw || typeof raw !== 'object') {
        return null;
      }
      const normalized = normalizeRemote(raw);
      try {
        await this.idb.put(storeName, id, normalized);
      } catch (putErr) {
        console.warn(`Failed to cache ${storeName}/${id} in IndexedDB:`, putErr);
      }
      return normalized;
    } catch (err) {
      console.warn(`Failed to fetch catalog entity from ${url}:`, err);
      return null;
    }
  }

  private async getCachedOrRemoteEntity<
    T extends { updatedAt?: string },
    S extends { updatedAt?: string }
  >(params: {
    storeName: string;
    collectionName: 'recipes' | 'colours';
    id: string;
    summary: S | undefined;
    normalizeRemote: (raw: Record<string, unknown>, summary?: S) => T;
    synthesize: (summary: S) => T;
  }): Promise<T | null> {
    const { storeName, collectionName, id, summary, normalizeRemote, synthesize } = params;
    const cached = await this.idb.get<T>(storeName, id);
    if (cached && (!summary?.updatedAt || cached.updatedAt === summary.updatedAt)) {
      return normalizeRemote(cached as unknown as Record<string, unknown>, summary);
    }

    const isSafeId = SAFE_ENTITY_ID_RE.test(id);
    if (isSafeId) {
      const fb = await this.getFirestoreHandle();
      if (fb) {
        try {
          const snap = await fb.getDoc(fb.doc(fb.db, collectionName, id));
          if (snap.exists()) {
            const normalized = normalizeRemote(snap.data() as Record<string, unknown>, summary);
            try {
              await this.idb.put(storeName, id, normalized);
            } catch (putErr) {
              console.warn(`Failed to cache ${collectionName}/${id} in IndexedDB:`, putErr);
            }
            return normalized;
          }
        } catch (err) {
          console.warn(`Firestore ${collectionName}/${id} fetch failed, falling back:`, err);
        }
      }

      const encodedId = encodeURIComponent(id);
      const staticEntity = await this.tryFetchAndCacheEntity(
        `/data/${collectionName}/${encodedId}.json`,
        storeName,
        id,
        (raw) => normalizeRemote(raw, summary),
        { cache: 'no-cache' }
      );
      if (staticEntity) {
        return staticEntity;
      }

      const bearer = this.getCachedBearerToken();
      if (bearer) {
        const apiEntity = await this.tryFetchAndCacheEntity(
          `/gw-paint-api/${collectionName}/${encodedId}?locale=en`,
          storeName,
          id,
          (raw) => normalizeRemote(raw, summary),
          {
            headers: {
              Accept: 'application/json',
              Authorization: `Bearer ${bearer}`,
            },
          }
        );
        if (apiEntity) {
          return apiEntity;
        }
      }
    }

    if (cached) {
      return normalizeRemote(cached as unknown as Record<string, unknown>, summary);
    }
    if (!summary) {
      return null;
    }
    return synthesize(summary);
  }
}
