import { Injectable, computed, inject, signal } from '@angular/core';
import {
  CatalogManifest,
  CatalogSyncStatus,
  CitadelThirdPartyMatchRef,
  ColorDetails,
  ColorGroup,
  ColorSummary,
  GameSystem,
  KNOWN_THIRD_PARTY_BRANDS,
  ModelRecipe,
  ModelSummary,
  Paint,
  PaintCompatibilityLink,
  ThirdPartyPaint,
} from '../models/catalog.models';
import { mergeCatalogBrands } from '../utils/catalog-filter.util';
import {
  RawColorSummary,
  normalizeColorSummary,
  normalizeModelSummary,
  normalizePaintingStageLabel,
} from '../utils/catalog-normalizer.util';
import { CatalogRepository } from './catalog.repository';

export { normalizePaintingStageLabel };

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

@Injectable({
  providedIn: 'root',
})
export class CatalogService {
  private readonly repo = inject(CatalogRepository);

  private readonly _loading = signal<boolean>(true);
  private readonly _syncStatus = signal<CatalogSyncStatus>(CatalogSyncStatus.Hydrating);
  private readonly _lastCheckedAt = signal<string | null>(null);

  private readonly _manifest = signal<CatalogManifest | null>(null);
  private readonly _paints = signal<Paint[]>([]);
  private readonly _compatibilityLinks = signal<PaintCompatibilityLink[]>([]);
  private readonly _thirdPartyPaints = signal<ThirdPartyPaint[]>([]);
  private readonly _thirdPartyBrands = signal<string[]>([...KNOWN_THIRD_PARTY_BRANDS]);
  private readonly _citadelToThirdPartyMap = signal<Record<string, CitadelThirdPartyMatchRef[]>>(
    {}
  );
  private readonly _colors = signal<ColorSummary[]>([]);
  private readonly _colorGroups = signal<ColorGroup[]>([]);
  private readonly _games = signal<GameSystem[]>([]);
  private readonly _models = signal<ModelSummary[]>([]);

  readonly loading = this._loading.asReadonly();
  readonly syncStatus = this._syncStatus.asReadonly();
  readonly lastCheckedAt = this._lastCheckedAt.asReadonly();

  readonly manifest = this._manifest.asReadonly();
  readonly paints = this._paints.asReadonly();
  readonly compatibilityLinks = this._compatibilityLinks.asReadonly();
  readonly thirdPartyPaints = this._thirdPartyPaints.asReadonly();
  readonly thirdPartyBrands = this._thirdPartyBrands.asReadonly();
  readonly citadelToThirdPartyMap = this._citadelToThirdPartyMap.asReadonly();
  readonly colors = this._colors.asReadonly();
  readonly colorGroups = this._colorGroups.asReadonly();
  readonly games = this._games.asReadonly();
  readonly models = this._models.asReadonly();

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

  private initPromise: Promise<void> | null = null;
  private initGeneration = 0;

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
    const runGen = ++this.initGeneration;
    this._loading.set(true);
    this._syncStatus.set(CatalogSyncStatus.Hydrating);

    if (forceFullRefresh) {
      await this.repo.clearAllCache();
      if (runGen !== this.initGeneration) {
        return;
      }
    }

    const cachedManifest = forceFullRefresh ? null : await this.repo.getCachedManifest();
    if (runGen !== this.initGeneration) {
      return;
    }

    let initialHydration = { checkedIds: new Set<string>(), presentIds: new Set<string>() };
    if (cachedManifest) {
      initialHydration = await this.hydrateSignalsFromIdb(cachedManifest, undefined, runGen);
      if (runGen !== this.initGeneration) {
        return;
      }
      this._loading.set(false);
    }

    try {
      const remoteManifest = await this.repo.fetchMetaDoc<CatalogManifest>('manifest');
      if (runGen !== this.initGeneration) {
        return;
      }

      const staleBundles = this.repo.findStaleBundles(remoteManifest, cachedManifest);
      const staleSet = new Set(staleBundles);
      const remoteBundles = this.repo.getValidBundlesMap(remoteManifest.bundles);
      const missingCheckedBundles = await this.repo.findMissingBundleIds(
        remoteBundles,
        staleSet,
        initialHydration.checkedIds,
        initialHydration.presentIds
      );
      if (runGen !== this.initGeneration) {
        return;
      }

      const bundlesToFetch = [...staleBundles, ...missingCheckedBundles];
      if (bundlesToFetch.length > 0) {
        this._syncStatus.set(CatalogSyncStatus.Updating);
        const fetchedBundles = await this.repo.fetchAndPersistBundles(
          bundlesToFetch,
          remoteManifest,
          cachedManifest,
          initialHydration.presentIds
        );
        if (runGen !== this.initGeneration) {
          return;
        }
        await this.hydrateSignalsFromIdb(remoteManifest, fetchedBundles, runGen);
        if (runGen !== this.initGeneration) {
          return;
        }
      } else {
        this._manifest.set(remoteManifest);
      }

      this._lastCheckedAt.set(new Date().toISOString());
      this._syncStatus.set(CatalogSyncStatus.UpToDate);
    } catch (err) {
      if (runGen !== this.initGeneration) {
        return;
      }
      console.warn('Manifest check failed, using cached/fallback data:', err);
      this._syncStatus.set(CatalogSyncStatus.OfflineCached);
    } finally {
      if (runGen === this.initGeneration) {
        this._loading.set(false);
      }
    }
  }

  private async hydrateSignalsFromIdb(
    manifest: CatalogManifest,
    inMemoryBundles?: ReadonlyMap<string, unknown>,
    runGen = this.initGeneration
  ): Promise<{ checkedIds: Set<string>; presentIds: Set<string> }> {
    const modelBundleKeys = this.repo.getModelBundleKeys(manifest);
    const allBundleKeys = [
      'paints_bundle',
      'third_party_paints_bundle',
      'colours_bundle',
      'games_factions_bundle',
      ...modelBundleKeys,
    ];
    const checkedIds = new Set<string>(allBundleKeys);

    const { bundles, presentIds } = await this.repo.readBundlesBatch(
      allBundleKeys,
      inMemoryBundles
    );
    if (runGen !== this.initGeneration) {
      return { checkedIds, presentIds };
    }

    this._manifest.set(manifest);

    const paintsBundle = bundles.get('paints_bundle') as
      | { paints: Paint[]; compatibility: PaintCompatibilityLink[] }
      | undefined;
    if (paintsBundle) {
      this._paints.set(paintsBundle.paints ?? []);
      this._compatibilityLinks.set(paintsBundle.compatibility ?? []);
    }

    const thirdPartyBundle = bundles.get('third_party_paints_bundle') as
      | {
          brands?: string[];
          thirdPartyPaints: ThirdPartyPaint[];
          citadelToThirdParty?: Record<string, CitadelThirdPartyMatchRef[]>;
          citadelToThirdPartyMap?: Record<string, CitadelThirdPartyMatchRef[]>;
        }
      | undefined;
    if (thirdPartyBundle) {
      const tpList = thirdPartyBundle.thirdPartyPaints ?? [];
      const brands = mergeCatalogBrands(thirdPartyBundle.brands, tpList);
      this._thirdPartyBrands.set(brands);
      this._thirdPartyPaints.set(tpList);
      this._citadelToThirdPartyMap.set(
        thirdPartyBundle.citadelToThirdPartyMap ?? thirdPartyBundle.citadelToThirdParty ?? {}
      );
    }

    const colorsBundle = bundles.get('colours_bundle') as
      | {
          colors?: RawColorSummary[];
          colours?: RawColorSummary[];
          colorGroups?: ColorGroup[];
          colourGroups?: ColorGroup[];
        }
      | undefined;
    if (colorsBundle) {
      const rawColors = colorsBundle.colors ?? colorsBundle.colours ?? [];
      this._colors.set(rawColors.map(normalizeColorSummary));
      this._colorGroups.set(colorsBundle.colorGroups ?? colorsBundle.colourGroups ?? []);
    }

    const gamesBundle = bundles.get('games_factions_bundle') as
      | { games: GameSystem[] }
      | undefined;
    if (gamesBundle) {
      this._games.set(gamesBundle.games ?? []);
    }

    const allModels = modelBundleKeys
      .flatMap(
        (key) =>
          (bundles.get(key) as { models?: (ModelSummary & { colourIds?: string[] })[] } | undefined)
            ?.models ?? []
      )
      .map(normalizeModelSummary);
    if (allModels.length > 0) {
      this._models.set(allModels);
    }

    return { checkedIds, presentIds };
  }

  async clearEntityCaches(): Promise<void> {
    await this.repo.clearEntityCaches();
  }

  /**
   * Fetches full ModelRecipe details (colorPoints, paintingAreas, step instructions).
   * Checks IndexedDB cache and validates `updatedAt` against the model summary in `models_index_*`.
   */
  async getModelRecipe(recipeId: string): Promise<ModelRecipe | null> {
    if (this.models().length === 0 && this.initPromise) {
      await this.initPromise;
    }
    return this.repo.getModelRecipe(
      recipeId,
      this.modelById().get(recipeId),
      this.colorById(),
      this.paintById()
    );
  }

  /**
   * Fetches full ColorDetails (Base/Detail/Artificer backpack showcase images and stage steps).
   * Checks IndexedDB cache and validates `updatedAt` against the color summary in `colors_bundle`.
   */
  async getColorDetails(colorId: string): Promise<ColorDetails | null> {
    if (this.colors().length === 0 && this.initPromise) {
      await this.initPromise;
    }
    return this.repo.getColorDetails(colorId, this.colorById().get(colorId), this.paintById());
  }
}
