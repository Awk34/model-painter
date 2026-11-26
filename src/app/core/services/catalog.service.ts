import { Injectable, computed, signal } from '@angular/core';
import {
  CatalogManifest,
  CatalogSyncStatus,
  CitadelThirdPartyMatchRef,
  ColorDetails,
  ColorFinishTier,
  ColorGroup,
  ColorStageStep,
  ColorSummary,
  GameSystem,
  KNOWN_THIRD_PARTY_BRANDS,
  ModelColorPoint,
  ModelPaintingArea,
  ModelPaintingStep,
  ModelRecipe,
  ModelSummary,
  Paint,
  PaintCompatibilityLink,
  ThirdPartyPaint,
} from '../models/catalog.models';
import { getFirebaseHandles } from './firebase.config';
import { createIdbStoreClient } from '../utils/idb.util';
import { getPaintRepresentativeHex, mergeCatalogBrands } from '../utils/catalog-filter.util';
import { doc, getDoc } from 'firebase/firestore';

const IDB_NAME = 'whc_catalog_cache_v1';
const IDB_VERSION = 1;
const STORE_BUNDLES = 'bundles';
const STORE_RECIPES = 'recipes';
const STORE_COLORS = 'colors';
const SAFE_ENTITY_ID_RE = /^[a-zA-Z0-9_-]+$/;
const PKCE_TOKEN_CACHE_KEY = 'whc_pkce_token_cache';
const MODEL_BUNDLE_PREFIX = 'models_index_';

export function normalizePaintingStageLabel(stage: string | undefined): string {
  const normalized = (stage ?? '').trim().toLowerCase();
  if (normalized === 'detail' || normalized === 'battle ready' || normalized === 'detail finish') {
    return 'Detail Finish';
  }
  if (
    normalized === 'artificer' ||
    normalized === 'parade ready' ||
    normalized === 'artificer finish'
  ) {
    return 'Artificer Finish';
  }
  return 'Base Finish';
}

export function extractColorGroupNames(rawGroups: unknown): string[] {
  if (!Array.isArray(rawGroups)) {
    return [];
  }
  return rawGroups
    .map((g) => {
      if (typeof g === 'string') {
        return g;
      }
      if (
        g &&
        typeof g === 'object' &&
        'name' in g &&
        typeof (g as { name?: unknown }).name === 'string'
      ) {
        return (g as { name: string }).name;
      }
      return '';
    })
    .filter(Boolean);
}

function readCachedWarhammerBearer(): string | null {
  try {
    const raw =
      sessionStorage.getItem(PKCE_TOKEN_CACHE_KEY) ??
      localStorage.getItem(PKCE_TOKEN_CACHE_KEY);
    if (!raw) {
      return null;
    }
    const parsed: unknown = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed === 'object' &&
      'bearer' in parsed &&
      typeof (parsed as { bearer?: unknown }).bearer === 'string'
    ) {
      const token = (parsed as { bearer: string }).bearer.trim();
      return token.length > 0 ? token : null;
    }
  } catch (err) {
    console.warn('Failed to read cached Warhammer bearer token:', err);
  }
  return null;
}

function indexById<T extends { id: string }>(items: readonly T[]): Map<string, T> {
  const map = new Map<string, T>();
  for (const item of items) {
    map.set(item.id, item);
  }
  return map;
}

function groupByKey<T>(items: readonly T[], keyFn: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const key = keyFn(item);
    let list = map.get(key);
    if (!list) {
      list = [];
      map.set(key, list);
    }
    list.push(item);
  }
  return map;
}

function indexByForeignIds<T>(
  items: readonly T[],
  idsFn: (item: T) => readonly string[]
): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    for (const id of idsFn(item)) {
      let list = map.get(id);
      if (!list) {
        list = [];
        map.set(id, list);
      }
      list.push(item);
    }
  }
  return map;
}

type RawColorSummary = ColorSummary & {
  colourGroups?: (string | { name?: string })[];
};

function normalizeColorSummary(c: RawColorSummary): ColorSummary {
  const colorGroups = extractColorGroupNames(c.colorGroups ?? c.colourGroups);
  const basePaintIds = c.basePaintIds ?? c.paintsByStage?.base ?? [];
  const detailPaintIds = c.detailPaintIds ?? c.paintsByStage?.detail ?? [];
  const artificerPaintIds = c.artificerPaintIds ?? c.paintsByStage?.artificer ?? [];
  const requiredPaintIds =
    c.requiredPaintIds ??
    c.allPaintIds ??
    Array.from(new Set([...basePaintIds, ...detailPaintIds, ...artificerPaintIds]));

  return {
    ...c,
    colorGroups,
    basePaintIds,
    detailPaintIds,
    artificerPaintIds,
    requiredPaintIds,
  };
}

function normalizeModelSummary(m: ModelSummary & { colourIds?: string[] }): ModelSummary {
  const base = m.paintsByStage?.base ?? [];
  const detail = m.paintsByStage?.detail ?? [];
  const artificer = m.paintsByStage?.artificer ?? [];

  return {
    ...m,
    gameIds: m.gameIds ?? [],
    gameNames: m.gameNames ?? [],
    factionIds: m.factionIds ?? [],
    factionNames: m.factionNames ?? [],
    colorIds: m.colorIds ?? m.colourIds ?? [],
    paintsByStage: { base, detail, artificer },
    requiredPaintIds:
      m.requiredPaintIds ?? m.allPaintIds ?? Array.from(new Set([...base, ...detail, ...artificer])),
  };
}

@Injectable({
  providedIn: 'root',
})
export class CatalogService {
  readonly loading = signal<boolean>(true);
  readonly syncStatus = signal<CatalogSyncStatus>(CatalogSyncStatus.Hydrating);
  readonly lastCheckedAt = signal<string | null>(null);

  readonly manifest = signal<CatalogManifest | null>(null);
  readonly paints = signal<Paint[]>([]);
  readonly compatibilityLinks = signal<PaintCompatibilityLink[]>([]);
  readonly thirdPartyPaints = signal<ThirdPartyPaint[]>([]);
  readonly thirdPartyBrands = signal<string[]>([...KNOWN_THIRD_PARTY_BRANDS]);
  readonly citadelToThirdPartyMap = signal<Record<string, CitadelThirdPartyMatchRef[]>>({});
  readonly colors = signal<ColorSummary[]>([]);
  readonly colorGroups = signal<ColorGroup[]>([]);
  readonly games = signal<GameSystem[]>([]);
  readonly models = signal<ModelSummary[]>([]);

  /** Fast O(1) lookup maps */
  readonly paintById = computed(() => indexById(this.paints()));
  readonly thirdPartyPaintById = computed(() => indexById(this.thirdPartyPaints()));
  readonly colorById = computed(() => indexById(this.colors()));
  readonly modelById = computed(() => indexById(this.models()));

  /** Bidirectional Classic <-> Tone Pro map */
  readonly classicToToneProMap = computed(() =>
    groupByKey(this.compatibilityLinks(), (link) => link.classic_paint_id)
  );

  readonly toneProToClassicMap = computed(() =>
    groupByKey(this.compatibilityLinks(), (link) => link.tone_pro_paint_id)
  );

  /** Reverse lookup maps: which models/colors use a given paint, and which models use a given color */
  readonly modelsUsingPaintMap = computed(() =>
    indexByForeignIds(this.models(), (m) => m.requiredPaintIds)
  );

  readonly colorsUsingPaintMap = computed(() =>
    indexByForeignIds(this.colors(), (c) => c.requiredPaintIds)
  );

  readonly modelsUsingColorMap = computed(() =>
    indexByForeignIds(this.models(), (m) => m.colorIds)
  );

  private readonly idb = createIdbStoreClient(IDB_NAME, IDB_VERSION, [
    STORE_BUNDLES,
    STORE_RECIPES,
    STORE_COLORS,
  ]);

  private initPromise: Promise<void> | null = null;

  constructor() {
    this.initPromise = this.initializeCatalog();
  }

  /**
   * Bootstraps the catalog using the Manifest Hash-Diffing protocol:
   * 1. Hydrate immediately from IndexedDB if cached (`0ms` boot).
   * 2. Perform a 1-doc manifest check (`catalog_meta/manifest`).
   * 3. Compare bundle hashes and fetch ONLY changed/missing bundles.
   */
  async initializeCatalog(forceFullRefresh = false): Promise<void> {
    const run = this.runInitializeCatalog(forceFullRefresh);
    this.initPromise = run;
    return run;
  }

  private async runInitializeCatalog(forceFullRefresh = false): Promise<void> {
    this.loading.set(true);
    this.syncStatus.set(CatalogSyncStatus.Hydrating);

    if (forceFullRefresh) {
      await this.idb.clearAll();
    }

    const cachedManifest = forceFullRefresh
      ? null
      : await this.idb.get<CatalogManifest>(STORE_BUNDLES, 'manifest');

    if (cachedManifest) {
      await this.hydrateSignalsFromIdb(cachedManifest);
      this.loading.set(false);
    }

    try {
      const remoteManifest = await this.fetchMetaDoc<CatalogManifest>('manifest');
      const staleBundles = this.findStaleBundles(remoteManifest, cachedManifest);

      if (staleBundles.length > 0) {
        this.syncStatus.set(CatalogSyncStatus.Updating);
        await Promise.all(
          staleBundles.map(async (bundleId) => {
            const data = await this.fetchMetaDoc<unknown>(bundleId);
            try {
              await this.idb.put(STORE_BUNDLES, bundleId, data);
            } catch (putErr) {
              console.warn(`Failed to cache catalog bundle ${bundleId} in IndexedDB:`, putErr);
            }
          })
        );
        try {
          await this.idb.put(STORE_BUNDLES, 'manifest', remoteManifest);
        } catch (putErr) {
          console.warn('Failed to cache catalog manifest in IndexedDB:', putErr);
        }
        await this.hydrateSignalsFromIdb(remoteManifest);
      } else {
        this.manifest.set(remoteManifest);
      }

      this.lastCheckedAt.set(new Date().toISOString());
      this.syncStatus.set(CatalogSyncStatus.UpToDate);
    } catch (err) {
      console.warn('Manifest check failed, using cached/fallback data:', err);
      this.syncStatus.set(CatalogSyncStatus.OfflineCached);
    } finally {
      this.loading.set(false);
    }
  }

  private findStaleBundles(
    remoteManifest: CatalogManifest,
    cachedManifest: CatalogManifest | null
  ): string[] {
    const staleBundles: string[] = [];
    for (const bundleId of Object.keys(remoteManifest.bundles)) {
      const remoteEntry = remoteManifest.bundles[bundleId];
      const localEntry = cachedManifest?.bundles?.[bundleId];
      const remoteHash = typeof remoteEntry === 'string' ? remoteEntry : remoteEntry?.hash;
      const localHash = typeof localEntry === 'string' ? localEntry : localEntry?.hash;
      if (!cachedManifest || remoteHash !== localHash) {
        staleBundles.push(bundleId);
      }
    }
    return staleBundles;
  }

  private getModelBundleKeys(manifest: CatalogManifest): string[] {
    return Object.keys(manifest.bundles ?? {})
      .filter((key) => key.startsWith(MODEL_BUNDLE_PREFIX))
      .sort((a, b) => {
        const numA = Number.parseInt(a.slice(MODEL_BUNDLE_PREFIX.length), 10);
        const numB = Number.parseInt(b.slice(MODEL_BUNDLE_PREFIX.length), 10);
        if (Number.isFinite(numA) && Number.isFinite(numB)) {
          return numA - numB;
        }
        return a.localeCompare(b);
      });
  }

  private async hydrateSignalsFromIdb(manifest: CatalogManifest): Promise<void> {
    this.manifest.set(manifest);
    const modelBundleKeys = this.getModelBundleKeys(manifest);

    const [paintsBundle, thirdPartyBundle, colorsBundle, gamesBundle, modelBundles] =
      await Promise.all([
        this.idb.get<{ paints: Paint[]; compatibility: PaintCompatibilityLink[] }>(
          STORE_BUNDLES,
          'paints_bundle'
        ),
        this.idb.get<{
          brands?: string[];
          thirdPartyPaints: ThirdPartyPaint[];
          citadelToThirdParty?: Record<string, CitadelThirdPartyMatchRef[]>;
          citadelToThirdPartyMap?: Record<string, CitadelThirdPartyMatchRef[]>;
        }>(STORE_BUNDLES, 'third_party_paints_bundle'),
        this.idb.get<{
          colors?: RawColorSummary[];
          colours?: RawColorSummary[];
          colorGroups?: ColorGroup[];
          colourGroups?: ColorGroup[];
        }>(STORE_BUNDLES, 'colours_bundle'),
        this.idb.get<{ games: GameSystem[] }>(STORE_BUNDLES, 'games_factions_bundle'),
        Promise.all(
          modelBundleKeys.map((key) =>
            this.idb.get<{ models: (ModelSummary & { colourIds?: string[] })[] }>(
              STORE_BUNDLES,
              key
            )
          )
        ),
      ]);

    if (paintsBundle) {
      this.paints.set(paintsBundle.paints ?? []);
      this.compatibilityLinks.set(paintsBundle.compatibility ?? []);
    }

    if (thirdPartyBundle) {
      const tpList = thirdPartyBundle.thirdPartyPaints ?? [];
      const brands = mergeCatalogBrands(thirdPartyBundle.brands, tpList);
      this.thirdPartyBrands.set(brands);
      this.thirdPartyPaints.set(tpList);
      this.citadelToThirdPartyMap.set(
        thirdPartyBundle.citadelToThirdPartyMap ?? thirdPartyBundle.citadelToThirdParty ?? {}
      );
    }

    if (colorsBundle) {
      const rawColors = colorsBundle.colors ?? colorsBundle.colours ?? [];
      this.colors.set(rawColors.map(normalizeColorSummary));
      this.colorGroups.set(colorsBundle.colorGroups ?? colorsBundle.colourGroups ?? []);
    }

    if (gamesBundle) {
      this.games.set(gamesBundle.games ?? []);
    }

    const allModels = modelBundles
      .flatMap((bundle) => bundle?.models ?? [])
      .map(normalizeModelSummary);
    if (allModels.length > 0) {
      this.models.set(allModels);
    }
  }

  private async fetchMetaDoc<T>(docId: string): Promise<T> {
    const fb = getFirebaseHandles();
    if (fb) {
      try {
        const snap = await getDoc(doc(fb.db, 'catalog_meta', docId));
        if (snap.exists()) {
          return snap.data() as T;
        }
      } catch (err) {
        console.warn(`Firestore catalog_meta/${docId} fetch failed, falling back to static bundle:`, err);
      }
    }
    const resp = await fetch(`/data/catalog_meta/${docId}.json`, { cache: 'no-cache' });
    if (!resp.ok) {
      throw new Error(`Failed to load /data/catalog_meta/${docId}.json: ${resp.status}`);
    }
    return (await resp.json()) as T;
  }

  async clearEntityCaches(): Promise<void> {
    await Promise.all([
      this.idb.clearStore(STORE_RECIPES),
      this.idb.clearStore(STORE_COLORS),
    ]);
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
    const fb = getFirebaseHandles();
    if (fb && isSafeId) {
      try {
        const snap = await getDoc(doc(fb.db, collectionName, id));
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

    if (isSafeId) {
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

      const bearer = readCachedWarhammerBearer();
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

  /**
   * Fetches full ModelRecipe details (colorPoints, paintingAreas, step instructions).
   * Checks IndexedDB cache and validates `updatedAt` against the model summary in `models_index_*`.
   */
  async getModelRecipe(recipeId: string): Promise<ModelRecipe | null> {
    if (this.models().length === 0 && this.initPromise) {
      await this.initPromise;
    }
    return this.getCachedOrRemoteEntity<ModelRecipe, ModelSummary>({
      storeName: STORE_RECIPES,
      collectionName: 'recipes',
      id: recipeId,
      summary: this.modelById().get(recipeId),
      normalizeRemote: (rawDoc, summary) => this.normalizeModelRecipe(rawDoc, summary),
      synthesize: (summary) => this.synthesizeModelRecipe(summary),
    });
  }

  private normalizeModelRecipe(
    rawDoc: Record<string, unknown>,
    summary?: ModelSummary
  ): ModelRecipe {
    const raw = rawDoc as Partial<ModelRecipe> & {
      colourPoints?: Array<Partial<ModelColorPoint> & { colourId?: string }>;
    };
    const rawPoints = raw.colorPoints ?? raw.colourPoints ?? [];
    const colorMap = this.colorById();
    const colorPoints: ModelColorPoint[] = rawPoints.map((cp, idx) => {
      const colorId = cp.colorId ?? (cp as { colourId?: string }).colourId ?? '';
      const colSummary = colorId ? colorMap.get(colorId) : undefined;
      const point =
        cp.point && typeof cp.point.x === 'number' && typeof cp.point.y === 'number'
          ? cp.point
          : { x: 0.5, y: 0.5 };
      return {
        id: cp.id ?? (colorId ? `cp_${colorId}` : `cp_${idx}`),
        name: cp.name ?? colSummary?.name ?? '',
        colorId,
        hex: cp.hex ?? colSummary?.hex ?? '#888888',
        point,
        imageUrl: cp.imageUrl ?? colSummary?.imageUrl,
        localImagePath: cp.localImagePath ?? colSummary?.localImagePath,
      };
    });

    const paintingAreas: ModelPaintingArea[] = (raw.paintingAreas ?? []).map((area, areaIdx) => ({
      id: area.id ?? `area_${areaIdx}`,
      areaOrder: area.areaOrder ?? areaIdx + 1,
      name: area.name ?? 'Painting Area',
      subsectionName: area.subsectionName,
      imageUrl: area.imageUrl,
      localImagePath: area.localImagePath,
      paintingSteps: (area.paintingSteps ?? []).map((step, stepIdx): ModelPaintingStep => {
        const stepOrder = step.stepOrder ?? stepIdx + 1;
        return {
          ...step,
          id: step.id ?? `step_${areaIdx}_${stepIdx}`,
          stepOrder,
          stepNumber: step.stepNumber ?? stepOrder,
          paintingStage: normalizePaintingStageLabel(step.paintingStage),
          paint: this.enrichStepPaint(step.paint),
        };
      }),
    }));

    const games = raw.games?.length
      ? raw.games
      : (summary?.gameIds ?? []).map((gid, i) => ({
          id: gid,
          name: summary?.gameNames?.[i] ?? 'Miniature Game',
        }));

    const factions = raw.factions?.length
      ? raw.factions
      : (summary?.factionIds ?? []).map((fid, i) => ({
          gameId: summary?.gameIds?.[0] ?? '',
          gameName: summary?.gameNames?.[0] ?? '',
          factionId: fid,
          factionName: summary?.factionNames?.[i] ?? '',
        }));

    const images = raw.images?.length
      ? raw.images
      : summary?.primaryImage
      ? [summary.primaryImage]
      : [];

    const localImagePaths = raw.localImagePaths?.length
      ? raw.localImagePaths
      : summary?.localPrimaryImage
      ? [summary.localPrimaryImage]
      : [];

    return {
      id: raw.id ?? summary?.id ?? '',
      name: raw.name ?? summary?.name ?? '',
      range: raw.range ?? summary?.range ?? 'warhammer_colour',
      games,
      factions,
      images,
      localImagePaths,
      colorPoints,
      paintingAreas,
      updatedAt: raw.updatedAt ?? summary?.updatedAt,
    };
  }

  private synthesizeModelRecipe(summary: ModelSummary): ModelRecipe {
    const colorPoints = (summary.colorIds ?? [])
      .map((cid, idx) => {
        const col = this.colorById().get(cid);
        if (!col) {
          return null;
        }
        return {
          id: `cp_${cid}`,
          name: col.name,
          colorId: cid,
          hex: col.hex,
          point: {
            x: 0.25 + ((idx * 0.17) % 0.55),
            y: 0.22 + ((idx * 0.21) % 0.58),
          },
        };
      })
      .filter((x): x is NonNullable<typeof x> => Boolean(x));

    const baseSet = new Set(summary.paintsByStage?.base ?? []);
    const detailSet = new Set(summary.paintsByStage?.detail ?? []);

    const steps = (summary.requiredPaintIds ?? [])
      .map((pid, idx) => {
        const p = this.paintById().get(pid);
        if (!p) {
          return null;
        }
        return {
          id: `st_${pid}`,
          stepOrder: idx + 1,
          stepNumber: idx + 1,
          paintingStage: this.inferPaintingStage(pid, p.category, baseSet, detailSet),
          techniqueName: p.category,
          paint: {
            id: p.id,
            name: p.name,
            range: p.range,
            category: p.category,
            potStyle: p.potStyle,
            gradientStartHex: p.gradientStartHex,
            gradientMiddleHex: p.gradientMiddleHex,
            gradientEndHex: p.gradientEndHex,
            imageUrl: p.imageUrl,
            localImagePath: p.localImagePath,
          },
        };
      })
      .filter((x): x is NonNullable<typeof x> => Boolean(x));

    return {
      id: summary.id,
      name: summary.name,
      range: summary.range,
      games: (summary.gameIds ?? []).map((gid, i) => ({
        id: gid,
        name: summary.gameNames?.[i] ?? 'Miniature Game',
      })),
      factions: (summary.factionIds ?? []).map((fid, i) => ({
        gameId: summary.gameIds?.[0] ?? '',
        gameName: summary.gameNames?.[0] ?? '',
        factionId: fid,
        factionName: summary.factionNames?.[i] ?? '',
      })),
      images: summary.primaryImage ? [summary.primaryImage] : [],
      localImagePaths: summary.localPrimaryImage ? [summary.localPrimaryImage] : [],
      colorPoints,
      paintingAreas: [
        {
          id: 'area_required',
          areaOrder: 1,
          name: 'Required Miniature Paints',
          paintingSteps: steps,
        },
      ],
      updatedAt: summary.updatedAt,
    };
  }

  private inferPaintingStage(
    paintId: string,
    category: string | undefined,
    baseSet: Set<string>,
    detailSet: Set<string>
  ): string {
    if (baseSet.has(paintId)) {
      return 'Base Finish';
    }
    if (detailSet.has(paintId)) {
      return 'Detail Finish';
    }
    const catLower = (category ?? '').toLowerCase();
    if (catLower === 'base' || catLower === 'spray') {
      return 'Base Finish';
    }
    if (catLower === 'shade' || catLower === 'contrast') {
      return 'Detail Finish';
    }
    return 'Artificer Finish';
  }

  /**
   * Fetches full ColorDetails (Base/Detail/Artificer backpack showcase images and stage steps).
   * Checks IndexedDB cache and validates `updatedAt` against the color summary in `colors_bundle`.
   */
  async getColorDetails(colorId: string): Promise<ColorDetails | null> {
    if (this.colors().length === 0 && this.initPromise) {
      await this.initPromise;
    }
    return this.getCachedOrRemoteEntity<ColorDetails, ColorSummary>({
      storeName: STORE_COLORS,
      collectionName: 'colours',
      id: colorId,
      summary: this.colorById().get(colorId),
      normalizeRemote: (rawDoc, summary) => this.normalizeColorDetails(rawDoc, summary),
      synthesize: (summary) => this.synthesizeColorDetails(summary),
    });
  }

  private normalizeColorDetails(
    rawDoc: Record<string, unknown>,
    summary?: ColorSummary
  ): ColorDetails {
    const raw = rawDoc as Partial<ColorDetails> & { colourGroups?: unknown };
    const imageUrl = raw.imageUrl ?? summary?.imageUrl;
    const localImagePath = raw.localImagePath ?? summary?.localImagePath;
    return {
      id: raw.id ?? summary?.id ?? '',
      name: raw.name ?? summary?.name ?? '',
      hex: raw.hex ?? summary?.hex ?? '#888888',
      rgb: raw.rgb,
      range: raw.range ?? summary?.range ?? 'warhammer_colour',
      guideType: raw.guideType ?? summary?.guideType ?? 'miniature',
      colorGroups: extractColorGroupNames(
        raw.colorGroups ?? raw.colourGroups ?? summary?.colorGroups ?? []
      ),
      imageUrl,
      localImagePath,
      headerImage: raw.headerImage ?? summary?.headerImage,
      localHeaderImagePath: raw.localHeaderImagePath ?? summary?.localHeaderImagePath,
      galleryImages: raw.galleryImages,
      localGalleryImagePaths: raw.localGalleryImagePaths,
      baseFinish: this.normalizeColorFinishTier(raw.baseFinish, imageUrl, localImagePath),
      detailFinish: this.normalizeColorFinishTier(raw.detailFinish, imageUrl, localImagePath),
      artificerFinish: this.normalizeColorFinishTier(raw.artificerFinish, imageUrl, localImagePath),
      updatedAt: raw.updatedAt ?? summary?.updatedAt,
    };
  }

  private enrichStepPaint(
    stepPaint: ModelPaintingStep['paint'] | ColorStageStep['paint'] | undefined
  ): ModelPaintingStep['paint'] {
    if (!stepPaint) {
      return undefined;
    }
    const catalogPaint = stepPaint.id ? this.paintById().get(stepPaint.id) : undefined;
    const potStyle = stepPaint.potStyle ?? catalogPaint?.potStyle;
    const gradientStartHex = stepPaint.gradientStartHex ?? catalogPaint?.gradientStartHex;
    const gradientMiddleHex = stepPaint.gradientMiddleHex ?? catalogPaint?.gradientMiddleHex;
    const gradientEndHex = stepPaint.gradientEndHex ?? catalogPaint?.gradientEndHex;
    return {
      ...stepPaint,
      id: stepPaint.id ?? catalogPaint?.id ?? '',
      name: stepPaint.name ?? catalogPaint?.name ?? '',
      category: stepPaint.category ?? catalogPaint?.category,
      range: stepPaint.range ?? catalogPaint?.range,
      potStyle,
      gradientStartHex,
      gradientMiddleHex,
      gradientEndHex,
      imageUrl: stepPaint.imageUrl ?? catalogPaint?.imageUrl,
      localImagePath: stepPaint.localImagePath ?? catalogPaint?.localImagePath,
    };
  }

  private normalizeColorFinishTier(
    tier: ColorFinishTier | null | undefined,
    fallbackImage?: string,
    fallbackLocalImage?: string
  ): ColorFinishTier | undefined {
    if (!tier) {
      return undefined;
    }
    return {
      backpackImage: tier.backpackImage ?? fallbackImage,
      localBackpackImagePath: tier.localBackpackImagePath ?? fallbackLocalImage,
      stages: (tier.stages ?? []).map((step, idx): ColorStageStep => {
        const enriched = this.enrichStepPaint(step.paint);
        return {
          ...step,
          id: step.id ?? `cs_${step.paint?.id ?? idx}_${idx}`,
          stepOrder: step.stepOrder ?? idx + 1,
          paint: enriched
            ? {
                ...enriched,
                hex: step.paint?.hex ?? getPaintRepresentativeHex(enriched),
              }
            : undefined,
        };
      }),
    };
  }

  private synthesizeColorDetails(summary: ColorSummary): ColorDetails {
    return {
      id: summary.id,
      name: summary.name,
      hex: summary.hex,
      range: summary.range,
      guideType: summary.guideType,
      colorGroups: summary.colorGroups,
      imageUrl: summary.imageUrl,
      localImagePath: summary.localImagePath,
      headerImage: summary.headerImage,
      localHeaderImagePath: summary.localHeaderImagePath,
      baseFinish: {
        backpackImage: summary.imageUrl,
        localBackpackImagePath: summary.localImagePath,
        stages: this.paintIdsToColorSteps(summary.basePaintIds),
      },
      detailFinish: {
        backpackImage: summary.imageUrl,
        localBackpackImagePath: summary.localImagePath,
        stages: this.paintIdsToColorSteps(summary.detailPaintIds),
      },
      artificerFinish: {
        backpackImage: summary.imageUrl,
        localBackpackImagePath: summary.localImagePath,
        stages: this.paintIdsToColorSteps(summary.artificerPaintIds),
      },
      updatedAt: summary.updatedAt,
    };
  }

  private paintIdsToColorSteps(ids?: string[]): ColorStageStep[] {
    return (ids ?? [])
      .map((pid, idx) => {
        const p = this.paintById().get(pid);
        if (!p) {
          return null;
        }
        return {
          id: `cs_${pid}_${idx}`,
          stepOrder: idx + 1,
          technique: p.category,
          paint: {
            id: p.id,
            name: p.name,
            category: p.category,
            range: p.range,
            potStyle: p.potStyle,
            hex: getPaintRepresentativeHex(p),
            gradientStartHex: p.gradientStartHex,
            gradientMiddleHex: p.gradientMiddleHex,
            gradientEndHex: p.gradientEndHex,
            imageUrl: p.imageUrl,
            localImagePath: p.localImagePath,
          },
        };
      })
      .filter((x): x is NonNullable<typeof x> => Boolean(x));
  }
}
