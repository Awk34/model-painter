import { TestBed } from '@angular/core/testing';
import {
  CatalogManifest,
  CatalogSyncStatus,
  KNOWN_THIRD_PARTY_BRANDS,
} from '../models/catalog.models';
import { normalizePaintingStageLabel } from '../utils/catalog-normalizer.util';
import {
  CATALOG_IDB_NAME,
  CatalogRepository,
  STORE_BUNDLES,
  STORE_COLORS,
  STORE_RECIPES,
} from './catalog.repository';
import { CatalogService } from './catalog.service';

async function resetCatalogIdb(): Promise<void> {
  if (typeof indexedDB === 'undefined') {
    return;
  }
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase(CATALOG_IDB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
    req.onblocked = () => resolve();
  });
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('CatalogService', () => {
  let fetchSpy: jasmine.Spy<typeof window.fetch>;
  let routeResponses: Map<string, () => Response>;
  let activeServices: CatalogService[];

  function injectCatalogService(): CatalogService {
    const service = TestBed.inject(CatalogService);
    activeServices.push(service);
    return service;
  }

  beforeEach(async () => {
    activeServices = [];
    localStorage.removeItem('whc_pkce_token_cache');
    sessionStorage.removeItem('whc_pkce_token_cache');
    await resetCatalogIdb();

    routeResponses = new Map<string, () => Response>([
      [
        '/data/catalog_meta/manifest.json',
        () =>
          jsonResponse({
            schemaVersion: 1,
            updatedAt: '2026-11-15T00:00:00Z',
            bundles: {
              paints_bundle: 'sha256:paints_test',
              third_party_paints_bundle: 'sha256:tp_test',
              colours_bundle: 'sha256:colours_test',
              games_factions_bundle: 'sha256:games_test',
              models_index_0: 'sha256:models_0_test',
            },
          }),
      ],
      [
        '/data/catalog_meta/paints_bundle.json',
        () =>
          jsonResponse({
            paints: [
              {
                id: 'paint-gold',
                name: 'Retributor Armour',
                range: 'warhammer_colour',
                category: 'Base',
                gradientStartHex: '#C39E81',
                imageUrl: 'https://example.com/gold.png',
                localImagePath: 'assets/images/paints/gold.png',
              },
              {
                id: 'paint-leadbelcher',
                name: 'Leadbelcher',
                range: 'warhammer_colour',
                category: 'base',
                potStyle: 'metallic',
                gradientStartHex: '#F0F0F0',
                gradientMiddleHex: '#8A8A8A',
                gradientEndHex: '#151E24',
              },
            ],
            compatibility: [],
          }),
      ],
      [
        '/data/catalog_meta/third_party_paints_bundle.json',
        () =>
          jsonResponse({
            thirdPartyPaints: [],
            citadelToThirdPartyMap: {},
          }),
      ],
      [
        '/data/catalog_meta/colours_bundle.json',
        () =>
          jsonResponse({
            colourGroups: [{ id: 'grp-metallics', name: 'Metallics' }],
            colours: [
              {
                id: 'color-gold',
                name: 'Gold',
                hex: '#D4AF37',
                range: 'warhammer_colour',
                guideType: 'miniature',
                colourGroups: [{ id: 'grp-metallics', name: 'Metallics' }],
                paintsByStage: { base: ['paint-gold'], detail: [], artificer: [] },
                updatedAt: '2026-11-15T00:00:00Z',
              },
            ],
          }),
      ],
      [
        '/data/catalog_meta/games_factions_bundle.json',
        () => jsonResponse({ games: [] }),
      ],
      [
        '/data/catalog_meta/models_index_0.json',
        () =>
          jsonResponse({
            models: [
              {
                id: 'model-dante',
                name: 'Commander Dante',
                range: 'warhammer_colour',
                primaryImage: 'https://example.com/dante.jpg',
                localPrimaryImage: 'assets/images/models/dante.jpg',
                gameIds: ['game-40k'],
                gameNames: ['Warhammer 40,000'],
                factionIds: ['fac-ba'],
                factionNames: ['Blood Angels'],
                colourIds: ['color-gold'],
                paintsByStage: { base: ['paint-gold'], detail: [], artificer: [] },
                updatedAt: '2026-11-15T00:00:00Z',
              },
            ],
          }),
      ],
      [
        '/data/recipes/model-dante.json',
        () =>
          jsonResponse({
            id: 'model-dante',
            name: 'Commander Dante',
            range: 'warhammer_colour',
            colourPoints: [
              {
                id: 'cp-1',
                name: 'Gold',
                colourId: 'color-gold',
                hex: '#D4AF37',
                point: { x: 0.48, y: 0.31 },
              },
            ],
            paintingAreas: [
              {
                id: 'area-armour',
                name: 'Gold Armour',
                paintingSteps: [
                  {
                    id: 'step-1',
                    stepNumber: 1,
                    paintingStage: 'base',
                    techniqueName: 'Base',
                    paint: { id: 'paint-gold', name: 'Retributor Armour' },
                  },
                  {
                    id: 'step-2',
                    stepNumber: 2,
                    paintingStage: 'detail',
                    techniqueName: 'Shade',
                    paint: { id: 'paint-gold', name: 'Retributor Armour' },
                  },
                  {
                    id: 'step-3',
                    stepNumber: 3,
                    paintingStage: 'artificer',
                    techniqueName: 'Highlight',
                    paint: { id: 'paint-gold', name: 'Retributor Armour' },
                  },
                ],
              },
              {
                id: 'area-wings',
                name: 'Jump Pack',
                paintingSteps: [],
              },
            ],
          }),
      ],
      [
        '/data/colours/color-gold.json',
        () =>
          jsonResponse({
            id: 'color-gold',
            name: 'Gold',
            hex: '#D4AF37',
            colourGroups: [
              { id: 'grp-metallics', name: 'Metallics', hex: '#D4AF37' },
              { id: 'grp-yellows', name: 'Yellows & Golds', hex: '#FFD700' },
            ],
            baseFinish: {
              backpackImage: 'https://example.com/gold-backpack.jpg',
              stages: [
                {
                  id: 'cs-1',
                  technique: 'Base',
                  paint: { id: 'paint-gold', name: 'Retributor Armour' },
                },
              ],
            },
          }),
      ],
    ]);

    fetchSpy = spyOn(window, 'fetch').and.callFake(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const responder = routeResponses.get(url);
      if (responder) {
        return responder();
      }
      return new Response('<!doctype html><html></html>', {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      });
    });

    TestBed.configureTestingModule({
      providers: [CatalogService],
    });
  });

  afterEach(async () => {
    const pendingInits = activeServices
      .map((s) => (s as unknown as { initPromise: Promise<void> | null }).initPromise)
      .filter((p): p is Promise<void> => Boolean(p));
    if (pendingInits.length > 0) {
      await Promise.allSettled(pendingInits);
    }
    activeServices = [];
    TestBed.resetTestingModule();
    await resetCatalogIdb();
    localStorage.removeItem('whc_pkce_token_cache');
    sessionStorage.removeItem('whc_pkce_token_cache');
  });

  it('normalizes painting stage labels consistently', () => {
    expect(normalizePaintingStageLabel('base')).toBe('Base Finish');
    expect(normalizePaintingStageLabel('detail')).toBe('Detail Finish');
    expect(normalizePaintingStageLabel('artificer')).toBe('Artificer Finish');
    expect(normalizePaintingStageLabel('Detail Finish')).toBe('Detail Finish');
    expect(normalizePaintingStageLabel('Artificer Finish')).toBe('Artificer Finish');
  });

  it('loads full recipe from /data/recipes/{id}.json, preserves exact (x,y) pins, and normalizes paintingStage', async () => {
    const service = injectCatalogService();
    await service.initializeCatalog(true);
    await service.clearEntityCaches();

    const recipe = await service.getModelRecipe('model-dante');
    expect(recipe).not.toBeNull();
    expect(recipe!.colorPoints.length).toBe(1);
    expect(recipe!.colorPoints[0].colorId).toBe('color-gold');
    expect(recipe!.colorPoints[0].point).toEqual({ x: 0.48, y: 0.31 });
    expect(recipe!.paintingAreas.length).toBe(2);

    const steps = recipe!.paintingAreas[0].paintingSteps;
    expect(steps.map((s) => s.paintingStage)).toEqual([
      'Base Finish',
      'Detail Finish',
      'Artificer Finish',
    ]);
    expect(steps[0].paint?.gradientStartHex).toBe('#C39E81');
    expect(recipe!.games).toEqual([{ id: 'game-40k', name: 'Warhammer 40,000' }]);
    expect(recipe!.images).toEqual(['https://example.com/dante.jpg']);
  });

  it('loads color details from /data/colours/{id}.json and normalizes object colourGroups to string[]', async () => {
    const service = injectCatalogService();
    await service.initializeCatalog(true);
    await service.clearEntityCaches();

    const color = await service.getColorDetails('color-gold');
    expect(color).not.toBeNull();
    expect(color!.colorGroups).toEqual(['Metallics', 'Yellows & Golds']);
    expect(color!.baseFinish?.stages.length).toBe(1);
    expect(color!.baseFinish?.stages[0].paint?.hex).toBe('#C39E81');
    expect(color!.baseFinish?.stages[0].paint?.localImagePath).toBe('assets/images/paints/gold.png');
  });

  it('falls back to /gw-paint-api/recipes/{id}?locale=en when static recipe returns HTML and a PKCE token is cached', async () => {
    routeResponses.delete('/data/recipes/model-dante.json');
    routeResponses.set('/gw-paint-api/recipes/model-dante?locale=en', () =>
      jsonResponse({
        id: 'model-dante',
        name: 'Commander Dante',
        range: 'warhammer_colour',
        colourPoints: [
          {
            id: 'cp-live',
            name: 'Gold',
            colourId: 'color-gold',
            hex: '#D4AF37',
            point: { x: 0.62, y: 0.19 },
          },
        ],
        paintingAreas: [
          {
            id: 'area-live',
            name: 'Live API Armour',
            paintingSteps: [
              {
                id: 'step-live',
                stepNumber: 1,
                paintingStage: 'artificer',
                paint: { id: 'paint-gold', name: 'Retributor Armour' },
              },
            ],
          },
        ],
      })
    );
    sessionStorage.setItem(
      'whc_pkce_token_cache',
      JSON.stringify({ code: 'abc', bearer: 'test-bearer-token' })
    );

    const service = injectCatalogService();
    await service.initializeCatalog(true);
    await service.clearEntityCaches();

    const recipe = await service.getModelRecipe('model-dante');
    expect(recipe).not.toBeNull();
    expect(recipe!.colorPoints[0].point).toEqual({ x: 0.62, y: 0.19 });
    expect(recipe!.paintingAreas[0].name).toBe('Live API Armour');
    expect(recipe!.paintingAreas[0].paintingSteps[0].paintingStage).toBe('Artificer Finish');

    const apiCall = fetchSpy.calls
      .allArgs()
      .find((args) => args[0] === '/gw-paint-api/recipes/model-dante?locale=en');
    expect(apiCall).toBeDefined();
    const headers = apiCall?.[1]?.headers as Record<string, string> | undefined;
    expect(headers?.['Authorization']).toBe('Bearer test-bearer-token');
  });

  it('ignores legacy localStorage whc_pkce_token_cache and does not send Authorization from localStorage', async () => {
    routeResponses.delete('/data/recipes/model-dante.json');
    localStorage.setItem(
      'whc_pkce_token_cache',
      JSON.stringify({ code: 'abc', bearer: 'legacy-localstorage-token' })
    );
    sessionStorage.removeItem('whc_pkce_token_cache');

    const service = injectCatalogService();
    await service.initializeCatalog(true);
    await service.clearEntityCaches();

    const recipe = await service.getModelRecipe('model-dante');
    expect(recipe).not.toBeNull();

    const apiCall = fetchSpy.calls
      .allArgs()
      .find((args) => String(args[0]).startsWith('/gw-paint-api/'));
    expect(apiCall).toBeUndefined();
  });

  it('preserves metallic potStyle, gradientMiddleHex, and gradientEndHex on enriched recipe and color steps', async () => {
    routeResponses.set('/data/recipes/model-dante.json', () =>
      jsonResponse({
        id: 'model-dante',
        name: 'Commander Dante',
        range: 'warhammer_colour',
        colourPoints: [],
        paintingAreas: [
          {
            id: 'area-gunmetal',
            name: 'Gunmetal',
            paintingSteps: [
              {
                id: 'step-leadbelcher',
                stepNumber: 1,
                paintingStage: 'base',
                paint: { id: 'paint-leadbelcher', name: 'Leadbelcher' },
              },
            ],
          },
        ],
      })
    );
    routeResponses.set('/data/colours/color-gold.json', () =>
      jsonResponse({
        id: 'color-gold',
        name: 'Gunmetal',
        hex: '#455051',
        baseFinish: {
          stages: [
            {
              id: 'cs-leadbelcher',
              technique: 'Base',
              paint: { id: 'paint-leadbelcher', name: 'Leadbelcher' },
            },
          ],
        },
      })
    );

    const service = injectCatalogService();
    await service.initializeCatalog(true);
    await service.clearEntityCaches();

    const recipe = await service.getModelRecipe('model-dante');
    const stepPaint = recipe!.paintingAreas[0].paintingSteps[0].paint;
    expect(stepPaint?.potStyle).toBe('metallic');
    expect(stepPaint?.gradientStartHex).toBe('#F0F0F0');
    expect(stepPaint?.gradientMiddleHex).toBe('#8A8A8A');
    expect(stepPaint?.gradientEndHex).toBe('#151E24');

    const color = await service.getColorDetails('color-gold');
    const colorPaint = color!.baseFinish?.stages[0].paint;
    expect(colorPaint?.potStyle).toBe('metallic');
    expect(colorPaint?.hex).toBe('#8A8A8A');
    expect(colorPaint?.gradientMiddleHex).toBe('#8A8A8A');
    expect(colorPaint?.gradientEndHex).toBe('#151E24');
  });

  it('merges hard-coded KNOWN_THIRD_PARTY_BRANDS with dynamic brands pulled from third_party_paints_bundle', async () => {
    routeResponses.set('/data/catalog_meta/third_party_paints_bundle.json', () =>
      jsonResponse({
        brands: ['vallejo', 'Scale75'],
        thirdPartyPaints: [
          {
            id: 'tp-kimera-red',
            brand: 'Kimera Kolors',
            range: 'Pure Pigments',
            name: 'The Red',
            category: 'layer',
            hex: '#D62828',
            citadelMatches: [],
          },
          {
            id: 'tp-scale-black',
            brand: 'scale75',
            range: 'Scalecolor',
            name: 'Black',
            category: 'base',
            hex: '#111111',
            citadelMatches: [],
          },
        ],
        citadelToThirdPartyMap: {},
      })
    );

    const service = injectCatalogService();
    await service.initializeCatalog(true);

    expect(service.thirdPartyBrands()).toEqual([
      ...KNOWN_THIRD_PARTY_BRANDS,
      'Scale75',
      'Kimera Kolors',
    ]);
  });

  it('discovers models_index_* shards dynamically from manifest.bundles in numeric order without fetching nonexistent shards', async () => {
    const shards: Record<string, string> = {
      paints_bundle: 'sha256:paints_dyn',
      third_party_paints_bundle: 'sha256:tp_dyn',
      colours_bundle: 'sha256:colours_dyn',
      games_factions_bundle: 'sha256:games_dyn',
    };
    for (let i = 0; i <= 7; i++) {
      const key = `models_index_${i}`;
      shards[key] = `sha256:${key}`;
      routeResponses.set(`/data/catalog_meta/${key}.json`, () =>
        jsonResponse({
          models: [
            {
              id: `model-${i}`,
              name: `Model ${i}`,
              range: 'warhammer_colour',
              gameIds: [],
              gameNames: [],
              factionIds: [],
              factionNames: [],
              colourIds: [],
            },
          ],
        })
      );
    }
    shards['models_index_10'] = 'sha256:models_index_10';
    routeResponses.set('/data/catalog_meta/models_index_10.json', () =>
      jsonResponse({
        models: [
          {
            id: 'model-10',
            name: 'Model 10',
            range: 'warhammer_colour',
            gameIds: [],
            gameNames: [],
            factionIds: [],
            factionNames: [],
            colourIds: [],
          },
        ],
      })
    );
    routeResponses.set('/data/catalog_meta/manifest.json', () =>
      jsonResponse({
        schemaVersion: 1,
        updatedAt: '2026-11-20T00:00:00Z',
        bundles: shards,
      })
    );

    const service = injectCatalogService();
    await service.initializeCatalog(true);

    expect(service.models().map((m) => m.id)).toEqual([
      'model-0',
      'model-1',
      'model-2',
      'model-3',
      'model-4',
      'model-5',
      'model-6',
      'model-7',
      'model-10',
    ]);

    // When manifest only defines models_index_0, models_index_1..5 are NOT requested
    fetchSpy.calls.reset();
    routeResponses.set('/data/catalog_meta/manifest.json', () =>
      jsonResponse({
        schemaVersion: 1,
        updatedAt: '2026-11-21T00:00:00Z',
        bundles: {
          paints_bundle: 'sha256:paints_single',
          third_party_paints_bundle: 'sha256:tp_single',
          colours_bundle: 'sha256:colours_single',
          games_factions_bundle: 'sha256:games_single',
          models_index_0: 'sha256:models_0_single',
        },
      })
    );
    await service.initializeCatalog(true);
    const requestedUrls = fetchSpy.calls.allArgs().map((args) => args[0]);
    expect(requestedUrls).not.toContain('/data/catalog_meta/models_index_1.json');
    expect(requestedUrls).not.toContain('/data/catalog_meta/models_index_5.json');
  });

  it('logs console.warn on malformed entity JSON and still returns fetched recipe when idb.put fails', async () => {
    const warnSpy = spyOn(console, 'warn');
    const service = injectCatalogService();
    await service.initializeCatalog(true);
    await service.clearEntityCaches();

    // 1. Malformed JSON logs console.warn
    routeResponses.set('/data/recipes/bad-json.json', () =>
      new Response('{not-json', {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );
    const bad = await service.getModelRecipe('bad-json');
    expect(bad).toBeNull();
    expect(warnSpy).toHaveBeenCalled();

    // 2. idb.put rejection does NOT discard fetched ModelRecipe
    const repo = TestBed.inject(CatalogRepository);
    const idbClient = (repo as unknown as { idb: { put: jasmine.Spy } }).idb;
    spyOn(idbClient, 'put').and.rejectWith(new DOMException('Quota exceeded', 'QuotaExceededError'));

    const recipe = await service.getModelRecipe('model-dante');
    expect(recipe).not.toBeNull();
    expect(recipe!.id).toBe('model-dante');
  });

  it('ignores unsafe prototype keys in findStaleBundles and uses Object.hasOwn for cached manifest bundles', () => {
    const repo = TestBed.inject(CatalogRepository);

    const remoteBundles = JSON.parse(
      '{"__proto__":"sha256:evil","constructor":"sha256:evil2","prototype":"sha256:evil3","paints_bundle":"sha256:v2","toString":"sha256:custom"}'
    ) as Record<string, string>;
    const cachedBundles = {
      paints_bundle: 'sha256:v2',
    };

    const stale = repo.findStaleBundles(
      { schemaVersion: 1, updatedAt: '2026-11-26T00:00:00Z', bundles: remoteBundles },
      { schemaVersion: 1, updatedAt: '2026-11-25T00:00:00Z', bundles: cachedBundles }
    );

    expect(stale).toEqual(['toString']);
  });

  it('hydrates in-memory on idb.put failure for paints_bundle and does not advance manifest hash so reload re-fetches it', async () => {
    const idbStore = new Map<string, unknown>();
    let failPaintsPut = true;

    const attachIdbStub = (repo: CatalogRepository) => {
      const idbClient = (repo as unknown as {
        idb: {
          get: (store: string, key: string) => Promise<unknown>;
          getMany: (store: string, keys: readonly string[]) => Promise<Map<string, unknown>>;
          put: (store: string, key: string, value: unknown) => Promise<void>;
          clearAll: () => Promise<void>;
        };
      }).idb;

      spyOn(idbClient, 'get').and.callFake(async (store: string, key: string) => {
        return idbStore.get(`${store}:${key}`) ?? null;
      });
      spyOn(idbClient, 'getMany').and.callFake(
        async (store: string, keys: readonly string[]) => {
          const out = new Map<string, unknown>();
          for (const key of keys) {
            const val = idbStore.get(`${store}:${key}`);
            if (val !== undefined && val !== null) {
              out.set(key, val);
            }
          }
          return out;
        }
      );
      spyOn(idbClient, 'put').and.callFake(async (store: string, key: string, value: unknown) => {
        if (failPaintsPut && key === 'paints_bundle') {
          throw new DOMException('Quota exceeded', 'QuotaExceededError');
        }
        idbStore.set(`${store}:${key}`, value);
      });
      spyOn(idbClient, 'clearAll').and.callFake(async () => {
        idbStore.clear();
      });
    };

    const repo1 = TestBed.inject(CatalogRepository);
    attachIdbStub(repo1);
    const service1 = injectCatalogService();
    await (service1 as unknown as { initPromise: Promise<void> }).initPromise;

    // Fetched paints_bundle is still hydrated in-memory despite idb.put failure
    expect(service1.paints().length).toBeGreaterThan(0);
    expect(service1.models().length).toBeGreaterThan(0);
    const cachedManifest = idbStore.get('bundles:manifest') as CatalogManifest | undefined;
    expect(cachedManifest).toBeDefined();
    expect(cachedManifest?.bundles['paints_bundle']).toBeUndefined();
    expect(cachedManifest?.bundles['models_index_0']).toBe('sha256:models_0_test');

    // Simulate reload: fresh CatalogService instance with idb.put succeeding
    failPaintsPut = false;
    fetchSpy.calls.reset();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [CatalogService] });
    const repo2 = TestBed.inject(CatalogRepository);
    attachIdbStub(repo2);
    const service2 = injectCatalogService();
    await (service2 as unknown as { initPromise: Promise<void> }).initPromise;

    const requestedUrls = fetchSpy.calls.allArgs().map((args) => args[0]);
    expect(requestedUrls).toContain('/data/catalog_meta/paints_bundle.json');
    expect(requestedUrls).not.toContain('/data/catalog_meta/colours_bundle.json');
    expect(service2.paints().length).toBeGreaterThan(0);
    expect(service2.syncStatus()).toBe(CatalogSyncStatus.UpToDate);
  });

  it('re-fetches missing cached bundles even when cached manifest hashes match remote manifest', async () => {
    const idbStore = new Map<string, unknown>([
      [
        'bundles:manifest',
        {
          schemaVersion: 1,
          updatedAt: '2026-11-15T00:00:00Z',
          bundles: {
            paints_bundle: 'sha256:paints_test',
            third_party_paints_bundle: 'sha256:tp_test',
            colours_bundle: 'sha256:colours_test',
            games_factions_bundle: 'sha256:games_test',
            models_index_0: 'sha256:models_0_test',
          },
        },
      ],
      ['bundles:third_party_paints_bundle', { thirdPartyPaints: [], citadelToThirdPartyMap: {} }],
      ['bundles:colours_bundle', { colourGroups: [], colours: [] }],
      ['bundles:games_factions_bundle', { games: [] }],
      ['bundles:models_index_0', { models: [] }],
    ]);

    const repo = TestBed.inject(CatalogRepository);
    const idbClient = (repo as unknown as {
      idb: {
        get: (store: string, key: string) => Promise<unknown>;
        getMany: (store: string, keys: readonly string[]) => Promise<Map<string, unknown>>;
        put: (store: string, key: string, value: unknown) => Promise<void>;
      };
    }).idb;

    spyOn(idbClient, 'get').and.callFake(async (store: string, key: string) => {
      return idbStore.get(`${store}:${key}`) ?? null;
    });
    spyOn(idbClient, 'getMany').and.callFake(
      async (store: string, keys: readonly string[]) => {
        const out = new Map<string, unknown>();
        for (const key of keys) {
          const val = idbStore.get(`${store}:${key}`);
          if (val !== undefined && val !== null) {
            out.set(key, val);
          }
        }
        return out;
      }
    );
    spyOn(idbClient, 'put').and.callFake(async (store: string, key: string, value: unknown) => {
      idbStore.set(`${store}:${key}`, value);
    });

    const service = injectCatalogService();
    await (service as unknown as { initPromise: Promise<void> }).initPromise;

    const requestedUrls = fetchSpy.calls.allArgs().map((args) => args[0]);
    expect(requestedUrls).toContain('/data/catalog_meta/paints_bundle.json');
    expect(requestedUrls).not.toContain('/data/catalog_meta/colours_bundle.json');
    expect(service.paints().length).toBeGreaterThan(0);
    expect(service.syncStatus()).toBe(CatalogSyncStatus.UpToDate);
  });

  it('treats malformed non-object cachedManifest.bundles as stale and triggers re-fetch', async () => {
    const repo = TestBed.inject(CatalogRepository);

    expect(
      repo.findStaleBundles(
        { schemaVersion: 1, updatedAt: '2026-11-26T00:00:00Z', bundles: { '0': 'h', paints_bundle: 'p' } },
        { schemaVersion: 1, updatedAt: '2026-11-25T00:00:00Z', bundles: 'h' } as unknown as CatalogManifest
      )
    ).toEqual(['0', 'paints_bundle']);

    expect(
      repo.findStaleBundles(
        { schemaVersion: 1, updatedAt: '2026-11-26T00:00:00Z', bundles: { '0': 'h' } },
        { schemaVersion: 1, updatedAt: '2026-11-25T00:00:00Z', bundles: ['h'] } as unknown as CatalogManifest
      )
    ).toEqual(['0']);

    const idbStore = new Map<string, unknown>([
      [
        'bundles:manifest',
        {
          schemaVersion: 1,
          updatedAt: '2026-11-15T00:00:00Z',
          bundles: 'malformed-bundles-string',
        },
      ],
    ]);
    const idbClient = (repo as unknown as {
      idb: {
        get: (store: string, key: string) => Promise<unknown>;
        getMany: (store: string, keys: readonly string[]) => Promise<Map<string, unknown>>;
        put: (store: string, key: string, value: unknown) => Promise<void>;
      };
    }).idb;

    spyOn(idbClient, 'get').and.callFake(async (store: string, key: string) => {
      return idbStore.get(`${store}:${key}`) ?? null;
    });
    spyOn(idbClient, 'getMany').and.callFake(
      async (store: string, keys: readonly string[]) => {
        const out = new Map<string, unknown>();
        for (const key of keys) {
          const val = idbStore.get(`${store}:${key}`);
          if (val !== undefined && val !== null) {
            out.set(key, val);
          }
        }
        return out;
      }
    );
    spyOn(idbClient, 'put').and.callFake(async (store: string, key: string, value: unknown) => {
      idbStore.set(`${store}:${key}`, value);
    });

    const service = injectCatalogService();
    await (service as unknown as { initPromise: Promise<void> }).initPromise;

    const requestedUrls = fetchSpy.calls.allArgs().map((args) => args[0]);
    expect(requestedUrls).toContain('/data/catalog_meta/paints_bundle.json');
    expect(service.paints().length).toBeGreaterThan(0);
    expect(service.syncStatus()).toBe(CatalogSyncStatus.UpToDate);
  });

  it('populates and clears all 3 IndexedDB stores (bundles, recipes, colors) cleanly for isolation', async () => {
    const service = injectCatalogService();
    await (service as unknown as { initPromise: Promise<void> }).initPromise;
    await service.getModelRecipe('model-dante');
    await service.getColorDetails('color-gold');

    const repo = TestBed.inject(CatalogRepository);
    const idbClient = (repo as unknown as {
      idb: { get: <T>(store: string, key: string) => Promise<T | null> };
    }).idb;

    expect(await idbClient.get(STORE_BUNDLES, 'manifest')).not.toBeNull();
    expect(await idbClient.get(STORE_BUNDLES, 'paints_bundle')).not.toBeNull();
    expect(await idbClient.get(STORE_RECIPES, 'model-dante')).not.toBeNull();
    expect(await idbClient.get(STORE_COLORS, 'color-gold')).not.toBeNull();

    await repo.clearAllCache();
    expect(await idbClient.get(STORE_BUNDLES, 'manifest')).toBeNull();
    expect(await idbClient.get(STORE_BUNDLES, 'paints_bundle')).toBeNull();
    expect(await idbClient.get(STORE_RECIPES, 'model-dante')).toBeNull();
    expect(await idbClient.get(STORE_COLORS, 'color-gold')).toBeNull();
  });

  it('transitions to OfflineCached when remote manifest fetch fails after IDB hydration', async () => {
    const repo = TestBed.inject(CatalogRepository);
    const idbClient = (repo as unknown as {
      idb: {
        put: (store: string, key: string, value: unknown) => Promise<void>;
      };
    }).idb;

    await idbClient.put(STORE_BUNDLES, 'manifest', {
      schemaVersion: 1,
      updatedAt: '2026-11-15T00:00:00Z',
      bundles: {
        paints_bundle: 'sha256:paints_cached',
      },
    });
    await idbClient.put(STORE_BUNDLES, 'paints_bundle', {
      paints: [
        {
          id: 'paint-cached',
          name: 'Cached Blue',
          range: 'warhammer_colour',
          category: 'Base',
          gradientStartHex: '#112233',
        },
      ],
      compatibility: [],
    });

    routeResponses.set('/data/catalog_meta/manifest.json', () =>
      new Response('Offline', { status: 503 })
    );

    const warnSpy = spyOn(console, 'warn');
    const service = injectCatalogService();
    await (service as unknown as { initPromise: Promise<void> }).initPromise;

    expect(service.paints().map((p) => p.id)).toEqual(['paint-cached']);
    expect(service.syncStatus()).toBe(CatalogSyncStatus.OfflineCached);
    expect(service.loading()).toBeFalse();
    expect(warnSpy).toHaveBeenCalled();
  });

  it('discards stale concurrent initializeCatalog runs via initGeneration', async () => {
    const service = injectCatalogService();
    await (service as unknown as { initPromise: Promise<void> }).initPromise;

    let resolveSlowManifest!: (resp: Response) => void;
    let holdSlowManifest = true;

    fetchSpy.and.callFake((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/data/catalog_meta/manifest.json' && holdSlowManifest) {
        holdSlowManifest = false;
        return new Promise<Response>((resolve) => {
          resolveSlowManifest = resolve;
        });
      }
      const responder = routeResponses.get(url);
      if (responder) {
        return Promise.resolve(responder());
      }
      return Promise.resolve(new Response('Not Found', { status: 404 }));
    });

    // Start slow run (run 1 after constructor) then immediately start newer run (run 2)
    routeResponses.set('/data/catalog_meta/paints_bundle.json', () =>
      jsonResponse({
        paints: [
          {
            id: 'paint-newer',
            name: 'Newer Paint',
            range: 'warhammer_colour',
            category: 'Base',
            gradientStartHex: '#445566',
          },
        ],
        compatibility: [],
      })
    );
    const slowRun = service.initializeCatalog(false);
    while (!resolveSlowManifest) {
      await new Promise((r) => setTimeout(r, 0));
    }

    const newerRun = service.initializeCatalog(true);
    await newerRun;
    expect(service.paints().map((p) => p.id)).toEqual(['paint-newer']);

    // Now resolve the older manifest pointing to a stale paint bundle — it must be ignored
    routeResponses.set('/data/catalog_meta/paints_bundle.json', () =>
      jsonResponse({
        paints: [
          {
            id: 'paint-stale',
            name: 'Stale Paint',
            range: 'warhammer_colour',
            category: 'Base',
            gradientStartHex: '#999999',
          },
        ],
        compatibility: [],
      })
    );
    resolveSlowManifest(
      jsonResponse({
        schemaVersion: 1,
        updatedAt: '2026-11-10T00:00:00Z',
        bundles: { paints_bundle: 'sha256:stale_run' },
      })
    );
    await slowRun;

    expect(service.paints().map((p) => p.id)).toEqual(['paint-newer']);
    expect(service.syncStatus()).toBe(CatalogSyncStatus.UpToDate);
  });

  it('computes reverse lookup maps modelsUsingPaintMap, colorsUsingPaintMap, and modelsUsingColorMap', async () => {
    const service = injectCatalogService();
    await (service as unknown as { initPromise: Promise<void> }).initPromise;

    expect(service.modelsUsingPaintMap().get('paint-gold')?.map((m) => m.id)).toEqual([
      'model-dante',
    ]);
    expect(service.colorsUsingPaintMap().get('paint-gold')?.map((c) => c.id)).toEqual([
      'color-gold',
    ]);
    expect(service.modelsUsingColorMap().get('color-gold')?.map((m) => m.id)).toEqual([
      'model-dante',
    ]);
    expect(service.modelsUsingPaintMap().get('nonexistent')).toBeUndefined();
  });

  it('normalizes legacy third_party_paints_bundle payloads and supports CatalogBundleMeta entries', async () => {
    routeResponses.set('/data/catalog_meta/manifest.json', () =>
      jsonResponse({
        schemaVersion: 1,
        updatedAt: '2026-11-26T00:00:00Z',
        bundles: {
          paints_bundle: 'sha256:paints_test',
          third_party_paints_bundle: 'sha256:tp_legacy',
          colours_bundle: 'sha256:colours_test',
          games_factions_bundle: 'sha256:games_test',
          models_index_0: {
            hash: 'sha256:models_0_test',
            sizeBytes: 2_300_000,
            staticOnly: true,
          },
        },
      })
    );
    routeResponses.set('/data/catalog_meta/third_party_paints_bundle.json', () =>
      jsonResponse({
        thirdPartyPaints: [
          {
            id: 'tp-ttc-018',
            brand: 'Two Thin Coats',
            range: 'Core Range',
            code: 'TTC-018',
            name: "Dragon's Gold",
            category: 'base',
            potStyle: 'metallic',
            hex: '#C4912E',
            citadelMatches: [
              {
                citadelPaintId: 'paint-gold',
                citadelPaintName: 'Retributor Armour',
                citadelRange: 'warhammer_colour',
                citadelCategory: 'Base',
                citadelHex: '#C39E81',
                deltaE: 4.2,
                matchType: 'curated',
              },
            ],
          },
        ],
        citadelToThirdPartyMap: {
          'paint-gold': [
            {
              thirdPartyPaintId: 'tp-ttc-018',
              brand: 'Two Thin Coats',
              range: 'Core Range',
              name: "Dragon's Gold",
              hex: '#C4912E',
              deltaE: 4.2,
              matchType: 'curated',
            },
          ],
        },
      })
    );

    const service = injectCatalogService();
    await (service as unknown as { initPromise: Promise<void> }).initPromise;

    expect(service.models().length).toBe(1);
    const tp = service.thirdPartyPaints()[0];
    expect(tp.citadelMatches[0].matchQuality).toBe('exact');
    const ref = service.citadelToThirdPartyMap()['paint-gold'][0];
    expect(ref.matchQuality).toBe('exact');
    expect(ref.category).toBe('base');
    expect(ref.potStyle).toBe('metallic');
  });
});
