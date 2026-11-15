import { Injectable, computed, signal } from '@angular/core';
import {
  CatalogManifest,
  CatalogSyncStatus,
  CitadelThirdPartyMatchRef,
  ColorDetails,
  ColorGroup,
  ColorSummary,
  GameSystem,
  ModelRecipe,
  ModelSummary,
  Paint,
  PaintCompatibilityLink,
  ThirdPartyPaint,
} from '../models/catalog.models';
import { getFirebaseHandles } from './firebase.config';
import { doc, getDoc } from 'firebase/firestore';

const IDB_NAME = 'whc_catalog_cache_v1';
const IDB_VERSION = 1;
const STORE_BUNDLES = 'bundles';
const STORE_RECIPES = 'recipes';
const STORE_COLORS = 'colors';

@Injectable({
  providedIn: 'root',
})
export class CatalogService {
  readonly loading = signal<boolean>(true);
  readonly syncStatus = signal<CatalogSyncStatus>(CatalogSyncStatus.Hydrating);
  readonly lastCheckedAt = signal<string | null>(null);
  readonly updatedBundlesList = signal<string[]>([]);

  readonly manifest = signal<CatalogManifest | null>(null);
  readonly paints = signal<Paint[]>([]);
  readonly compatibilityLinks = signal<PaintCompatibilityLink[]>([]);
  readonly thirdPartyPaints = signal<ThirdPartyPaint[]>([]);
  readonly thirdPartyBrands = signal<string[]>([]);
  readonly citadelToThirdPartyMap = signal<Record<string, CitadelThirdPartyMatchRef[]>>({});
  readonly colors = signal<ColorSummary[]>([]);
  readonly colorGroups = signal<ColorGroup[]>([]);
  readonly games = signal<GameSystem[]>([]);
  readonly models = signal<ModelSummary[]>([]);

  /** Fast O(1) lookup maps */
  readonly paintById = computed(() => {
    const map = new Map<string, Paint>();
    for (const p of this.paints()) {
      map.set(p.id, p);
    }
    return map;
  });

  readonly thirdPartyPaintById = computed(() => {
    const map = new Map<string, ThirdPartyPaint>();
    for (const tp of this.thirdPartyPaints()) {
      map.set(tp.id, tp);
    }
    return map;
  });

  readonly colorById = computed(() => {
    const map = new Map<string, ColorSummary>();
    for (const c of this.colors()) {
      map.set(c.id, c);
    }
    return map;
  });

  readonly modelById = computed(() => {
    const map = new Map<string, ModelSummary>();
    for (const m of this.models()) {
      map.set(m.id, m);
    }
    return map;
  });

  /** Bidirectional Classic <-> Tone Pro map */
  readonly classicToToneProMap = computed(() => {
    const map = new Map<string, PaintCompatibilityLink[]>();
    for (const link of this.compatibilityLinks()) {
      const list = map.get(link.classic_paint_id) ?? [];
      list.push(link);
      map.set(link.classic_paint_id, list);
    }
    return map;
  });

  readonly toneProToClassicMap = computed(() => {
    const map = new Map<string, PaintCompatibilityLink[]>();
    for (const link of this.compatibilityLinks()) {
      const list = map.get(link.tone_pro_paint_id) ?? [];
      list.push(link);
      map.set(link.tone_pro_paint_id, list);
    }
    return map;
  });

  /** Reverse lookup maps: which models/colors use a given paint, and which models use a given color */
  readonly modelsUsingPaintMap = computed(() => {
    const map = new Map<string, ModelSummary[]>();
    for (const m of this.models()) {
      for (const pid of m.requiredPaintIds) {
        let arr = map.get(pid);
        if (!arr) {
          arr = [];
          map.set(pid, arr);
        }
        arr.push(m);
      }
    }
    return map;
  });

  readonly colorsUsingPaintMap = computed(() => {
    const map = new Map<string, ColorSummary[]>();
    for (const c of this.colors()) {
      for (const pid of c.requiredPaintIds) {
        let arr = map.get(pid);
        if (!arr) {
          arr = [];
          map.set(pid, arr);
        }
        arr.push(c);
      }
    }
    return map;
  });

  readonly modelsUsingColorMap = computed(() => {
    const map = new Map<string, ModelSummary[]>();
    for (const m of this.models()) {
      for (const cid of m.colorIds) {
        let arr = map.get(cid);
        if (!arr) {
          arr = [];
          map.set(cid, arr);
        }
        arr.push(m);
      }
    }
    return map;
  });

  private dbPromise: Promise<IDBDatabase> | null = null;
  private initPromise: Promise<void> | null = null;

  constructor() {
    this.initPromise = this.initializeCatalog();
  }

  private openIdb(): Promise<IDBDatabase> {
    if (this.dbPromise) return this.dbPromise;
    this.dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(IDB_NAME, IDB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_BUNDLES)) {
          db.createObjectStore(STORE_BUNDLES);
        }
        if (!db.objectStoreNames.contains(STORE_RECIPES)) {
          db.createObjectStore(STORE_RECIPES);
        }
        if (!db.objectStoreNames.contains(STORE_COLORS)) {
          db.createObjectStore(STORE_COLORS);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return this.dbPromise;
  }

  private async idbGet<T>(storeName: string, key: string): Promise<T | null> {
    try {
      const db = await this.openIdb();
      return await new Promise<T | null>((resolve, reject) => {
        const tx = db.transaction(storeName, 'readonly');
        const store = tx.objectStore(storeName);
        const req = store.get(key);
        req.onsuccess = () => resolve((req.result as T) ?? null);
        req.onerror = () => reject(req.error);
      });
    } catch {
      return null;
    }
  }

  private async idbSet<T>(storeName: string, key: string, value: T): Promise<void> {
    try {
      const db = await this.openIdb();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(storeName, 'readwrite');
        const store = tx.objectStore(storeName);
        const req = store.put(value, key);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    } catch {
      // ignore quota/idb errors
    }
  }

  private async idbClearAll(): Promise<void> {
    try {
      const db = await this.openIdb();
      await Promise.all(
        [STORE_BUNDLES, STORE_RECIPES, STORE_COLORS].map(
          (storeName) =>
            new Promise<void>((resolve) => {
              const tx = db.transaction(storeName, 'readwrite');
              tx.objectStore(storeName).clear();
              tx.oncomplete = () => resolve();
              tx.onerror = () => resolve();
            })
        )
      );
    } catch {
      // ignore
    }
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
      await this.idbClearAll();
    }

    const cachedManifest = forceFullRefresh
      ? null
      : await this.idbGet<CatalogManifest>(STORE_BUNDLES, 'manifest');

    if (cachedManifest) {
      await this.hydrateSignalsFromIdb(cachedManifest);
      this.loading.set(false);
    }

    // Fetch remote manifest (1 read)
    try {
      const remoteManifest = await this.fetchMetaDoc<CatalogManifest>('manifest');
      const requiredBundles = Object.keys(remoteManifest.bundles);
      const staleBundles: string[] = [];

      for (const bundleId of requiredBundles) {
        const remoteEntry = remoteManifest.bundles[bundleId];
        const localEntry = cachedManifest?.bundles?.[bundleId];
        const remoteHash = typeof remoteEntry === 'string' ? remoteEntry : remoteEntry?.hash;
        const localHash = typeof localEntry === 'string' ? localEntry : localEntry?.hash;
        if (!cachedManifest || remoteHash !== localHash) {
          staleBundles.push(bundleId);
        }
      }

      if (staleBundles.length > 0) {
        this.syncStatus.set(CatalogSyncStatus.Updating);
        this.updatedBundlesList.set(staleBundles);
        await Promise.all(
          staleBundles.map(async (bundleId) => {
            const data = await this.fetchMetaDoc<unknown>(bundleId);
            await this.idbSet(STORE_BUNDLES, bundleId, data);
          })
        );
        await this.idbSet(STORE_BUNDLES, 'manifest', remoteManifest);
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

  private async hydrateSignalsFromIdb(manifest: CatalogManifest): Promise<void> {
    this.manifest.set(manifest);

    const [
      paintsBundle,
      thirdPartyBundle,
      colorsBundle,
      gamesBundle,
      m0,
      m1,
      m2,
      m3,
      m4,
      m5,
    ] = await Promise.all([
      this.idbGet<{ paints: Paint[]; compatibility: PaintCompatibilityLink[] }>(
        STORE_BUNDLES,
        'paints_bundle'
      ),
      this.idbGet<{
        brands?: string[];
        thirdPartyPaints: ThirdPartyPaint[];
        citadelToThirdParty?: Record<string, CitadelThirdPartyMatchRef[]>;
        citadelToThirdPartyMap?: Record<string, CitadelThirdPartyMatchRef[]>;
      }>(STORE_BUNDLES, 'third_party_paints_bundle'),
      this.idbGet<{
        colors?: ColorSummary[];
        colours?: (ColorSummary & { colourGroups?: (string | { name?: string })[] })[];
        colorGroups?: ColorGroup[];
        colourGroups?: ColorGroup[];
      }>(STORE_BUNDLES, 'colours_bundle'),
      this.idbGet<{ games: GameSystem[] }>(STORE_BUNDLES, 'games_factions_bundle'),
      this.idbGet<{ models: ModelSummary[] }>(STORE_BUNDLES, 'models_index_0'),
      this.idbGet<{ models: ModelSummary[] }>(STORE_BUNDLES, 'models_index_1'),
      this.idbGet<{ models: ModelSummary[] }>(STORE_BUNDLES, 'models_index_2'),
      this.idbGet<{ models: ModelSummary[] }>(STORE_BUNDLES, 'models_index_3'),
      this.idbGet<{ models: ModelSummary[] }>(STORE_BUNDLES, 'models_index_4'),
      this.idbGet<{ models: ModelSummary[] }>(STORE_BUNDLES, 'models_index_5'),
    ]);

    if (paintsBundle) {
      this.paints.set(paintsBundle.paints ?? []);
      this.compatibilityLinks.set(paintsBundle.compatibility ?? []);
    }
    if (thirdPartyBundle) {
      const tpList = thirdPartyBundle.thirdPartyPaints ?? [];
      const brands =
        thirdPartyBundle.brands && thirdPartyBundle.brands.length > 0
          ? thirdPartyBundle.brands
          : Array.from(new Set(tpList.map((p) => p.brand).filter(Boolean)));
      this.thirdPartyBrands.set(brands);
      this.thirdPartyPaints.set(tpList);
      this.citadelToThirdPartyMap.set(
        thirdPartyBundle.citadelToThirdPartyMap ?? thirdPartyBundle.citadelToThirdParty ?? {}
      );
    }
    if (colorsBundle) {
      const rawColorList = colorsBundle.colors ?? colorsBundle.colours ?? [];
      const normalizedColors = rawColorList.map((c) => {
        const rawGroups = (c.colorGroups ??
          (c as { colourGroups?: (string | { name?: string })[] }).colourGroups ??
          []) as (string | { name?: string })[];
        const normalizedGroups = rawGroups
          .map((g) => (typeof g === 'string' ? g : g?.name ?? ''))
          .filter(Boolean);
        const basePaintIds = c.basePaintIds ?? c.paintsByStage?.base ?? [];
        const detailPaintIds = c.detailPaintIds ?? c.paintsByStage?.detail ?? [];
        const artificerPaintIds = c.artificerPaintIds ?? c.paintsByStage?.artificer ?? [];
        const requiredPaintIds =
          c.requiredPaintIds ??
          c.allPaintIds ??
          Array.from(new Set([...basePaintIds, ...detailPaintIds, ...artificerPaintIds]));
        return {
          ...c,
          colorGroups: normalizedGroups,
          basePaintIds,
          detailPaintIds,
          artificerPaintIds,
          requiredPaintIds,
        };
      });
      this.colors.set(normalizedColors);
      this.colorGroups.set(colorsBundle.colorGroups ?? colorsBundle.colourGroups ?? []);
    }
    if (gamesBundle) {
      this.games.set(gamesBundle.games ?? []);
    }

    const allModels: ModelSummary[] = [
      ...(m0?.models ?? []),
      ...(m1?.models ?? []),
      ...(m2?.models ?? []),
      ...(m3?.models ?? []),
      ...(m4?.models ?? []),
      ...(m5?.models ?? []),
    ].map((m) => ({
      ...m,
      gameIds: m.gameIds ?? [],
      gameNames: m.gameNames ?? [],
      factionIds: m.factionIds ?? [],
      factionNames: m.factionNames ?? [],
      colorIds: m.colorIds ?? (m as { colourIds?: string[] }).colourIds ?? [],
      paintsByStage: {
        base: m.paintsByStage?.base ?? [],
        detail: m.paintsByStage?.detail ?? [],
        artificer: m.paintsByStage?.artificer ?? [],
      },
      requiredPaintIds:
        m.requiredPaintIds ??
        m.allPaintIds ??
        Array.from(
          new Set([
            ...(m.paintsByStage?.base ?? []),
            ...(m.paintsByStage?.detail ?? []),
            ...(m.paintsByStage?.artificer ?? []),
          ])
        ),
    }));
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
      } catch {
        // Fallback to local static bundle
      }
    }
    const resp = await fetch(`/data/catalog_meta/${docId}.json`, { cache: 'no-cache' });
    if (!resp.ok) {
      throw new Error(`Failed to load /data/catalog_meta/${docId}.json: ${resp.status}`);
    }
    return (await resp.json()) as T;
  }

  /**
   * Fetches full ModelRecipe details (colorPoints, paintingAreas, step instructions).
   * Checks IndexedDB cache and validates `updatedAt` against the model summary in `models_index_*`.
   */
  async getModelRecipe(recipeId: string): Promise<ModelRecipe | null> {
    if (this.models().length === 0 && this.initPromise) {
      await this.initPromise;
    }
    const summary = this.modelById().get(recipeId);
    const cached = await this.idbGet<ModelRecipe>(STORE_RECIPES, recipeId);

    if (cached && (!summary?.updatedAt || cached.updatedAt === summary.updatedAt)) {
      return cached;
    }

    const fb = getFirebaseHandles();
    if (fb) {
      try {
        const snap = await getDoc(doc(fb.db, 'recipes', recipeId));
        if (snap.exists()) {
          const raw = snap.data() as ModelRecipe & {
            colourPoints?: Array<
              ModelRecipe['colorPoints'][0] & { colourId?: string }
            >;
          };
          const rawPoints = raw.colorPoints ?? raw.colourPoints ?? [];
          const data: ModelRecipe = {
            ...raw,
            colorPoints: rawPoints.map((cp) => ({
              ...cp,
              colorId: cp.colorId ?? (cp as { colourId?: string }).colourId ?? '',
            })),
          };
          await this.idbSet(STORE_RECIPES, recipeId, data);
          return data;
        }
      } catch {
        // fallback to summary synthesis
      }
    }

    if (cached) return cached;
    if (!summary) return null;

    // Synthesize from bundle summary when running without split recipe files
    const colorPoints = (summary.colorIds ?? [])
      .map((cid, idx) => {
        const col = this.colorById().get(cid);
        if (!col) return null;
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
        if (!p) return null;
        const catLower = (p.category ?? '').toLowerCase();
        const paintingStage = baseSet.has(pid)
          ? 'Base Finish'
          : detailSet.has(pid)
          ? 'Detail Finish'
          : catLower === 'base' || catLower === 'spray'
          ? 'Base Finish'
          : catLower === 'shade' || catLower === 'contrast'
          ? 'Detail Finish'
          : 'Artificer Finish';
        return {
          id: `st_${pid}`,
          stepOrder: idx + 1,
          stepNumber: idx + 1,
          paintingStage,
          techniqueName: p.category,
          paint: {
            id: p.id,
            name: p.name,
            range: p.range,
            category: p.category,
            gradientStartHex: p.gradientStartHex,
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

  /**
   * Fetches full ColorDetails (Base/Detail/Artificer backpack showcase images and stage steps).
   * Checks IndexedDB cache and validates `updatedAt` against the color summary in `colors_bundle`.
   */
  async getColorDetails(colorId: string): Promise<ColorDetails | null> {
    if (this.colors().length === 0 && this.initPromise) {
      await this.initPromise;
    }
    const summary = this.colorById().get(colorId);
    const cached = await this.idbGet<ColorDetails>(STORE_COLORS, colorId);

    if (cached && (!summary?.updatedAt || cached.updatedAt === summary.updatedAt)) {
      return cached;
    }

    const fb = getFirebaseHandles();
    if (fb) {
      try {
        const snap = await getDoc(doc(fb.db, 'colours', colorId));
        if (snap.exists()) {
          const raw = snap.data() as ColorDetails & { colourGroups?: string[] };
          const data: ColorDetails = {
            ...raw,
            colorGroups: raw.colorGroups ?? raw.colourGroups ?? [],
          };
          await this.idbSet(STORE_COLORS, colorId, data);
          return data;
        }
      } catch {
        // fallback to summary synthesis
      }
    }

    if (cached) return cached;
    if (!summary) return null;

    const toSteps = (ids?: string[]) =>
      (ids ?? [])
        .map((pid, idx) => {
          const p = this.paintById().get(pid);
          if (!p) return null;
          return {
            id: `cs_${pid}_${idx}`,
            stepOrder: idx + 1,
            technique: p.category,
            paint: {
              id: p.id,
              name: p.name,
              category: p.category,
              range: p.range,
              hex: p.gradientStartHex,
              gradientStartHex: p.gradientStartHex,
              imageUrl: p.imageUrl,
              localImagePath: p.localImagePath,
            },
          };
        })
        .filter((x): x is NonNullable<typeof x> => Boolean(x));

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
        stages: toSteps(summary.basePaintIds),
      },
      detailFinish: {
        backpackImage: summary.imageUrl,
        localBackpackImagePath: summary.localImagePath,
        stages: toSteps(summary.detailPaintIds),
      },
      artificerFinish: {
        backpackImage: summary.imageUrl,
        localBackpackImagePath: summary.localImagePath,
        stages: toSteps(summary.artificerPaintIds),
      },
      updatedAt: summary.updatedAt,
    };
  }
}
