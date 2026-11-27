import { TestBed } from '@angular/core/testing';
import { ColorSummary, ModelSummary, Paint } from '../models/catalog.models';
import { CatalogRepository } from './catalog.repository';
import { WarhammerImportService } from './warhammer-import.service';

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('CatalogRepository', () => {
  let repo: CatalogRepository;
  let fetchSpy: jasmine.Spy<typeof window.fetch>;
  let bearerToken: string | null;

  beforeEach(() => {
    bearerToken = null;
    TestBed.configureTestingModule({
      providers: [
        CatalogRepository,
        {
          provide: WarhammerImportService,
          useValue: {
            getCachedBearerToken: () => bearerToken,
          },
        },
      ],
    });
    repo = TestBed.inject(CatalogRepository);
    fetchSpy = spyOn(window, 'fetch');
  });

  it('deduplicates concurrent in-flight getModelRecipe and getColorDetails requests and clears map in finally', async () => {
    const idbClient = (repo as unknown as {
      idb: {
        get: jasmine.Spy;
        put: jasmine.Spy;
      };
    }).idb;
    spyOn(idbClient, 'get').and.resolveTo(null);
    spyOn(idbClient, 'put').and.resolveTo();

    let resolveRecipeFetch!: (resp: Response) => void;
    let resolveColorFetch!: (resp: Response) => void;

    fetchSpy.and.callFake((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/data/recipes/shared-id.json') {
        return new Promise<Response>((res) => {
          resolveRecipeFetch = res;
        });
      }
      if (url === '/data/colours/shared-id.json') {
        return new Promise<Response>((res) => {
          resolveColorFetch = res;
        });
      }
      return Promise.resolve(new Response('Not Found', { status: 404 }));
    });

    const paintMap = new Map<string, Paint>();
    const colorMap = new Map<string, ColorSummary>();

    const r1 = repo.getModelRecipe('shared-id', undefined, colorMap, paintMap);
    const r2 = repo.getModelRecipe('shared-id', undefined, colorMap, paintMap);
    const c1 = repo.getColorDetails('shared-id', undefined, paintMap);
    const c2 = repo.getColorDetails('shared-id', undefined, paintMap);

    // Wait a microtask for idb.get to settle and fetch to be invoked
    await Promise.resolve();
    await Promise.resolve();

    expect(
      fetchSpy.calls.allArgs().filter((a) => a[0] === '/data/recipes/shared-id.json').length
    ).toBe(1);
    expect(
      fetchSpy.calls.allArgs().filter((a) => a[0] === '/data/colours/shared-id.json').length
    ).toBe(1);

    resolveRecipeFetch(jsonResponse({ id: 'shared-id', name: 'Recipe Name', paintingAreas: [] }));
    resolveColorFetch(jsonResponse({ id: 'shared-id', name: 'Color Name', hex: '#123456' }));

    const [resR1, resR2, resC1, resC2] = await Promise.all([r1, r2, c1, c2]);
    expect(resR1?.name).toBe('Recipe Name');
    expect(resR2?.name).toBe('Recipe Name');
    expect(resC1?.name).toBe('Color Name');
    expect(resC2?.name).toBe('Color Name');

    // Subsequent call after completion fetches anew (not stuck in inFlightEntities)
    fetchSpy.calls.reset();
    fetchSpy.and.resolveTo(
      jsonResponse({ id: 'shared-id', name: 'Recipe Refetched', paintingAreas: [] })
    );
    const r3 = await repo.getModelRecipe('shared-id', undefined, colorMap, paintMap);
    expect(r3?.name).toBe('Recipe Refetched');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('batches bundle reads via idb.getMany and prefers inMemoryBundles', async () => {
    const idbClient = (repo as unknown as {
      idb: {
        getMany: jasmine.Spy;
      };
    }).idb;
    const getManySpy = spyOn(idbClient, 'getMany').and.resolveTo(
      new Map<string, unknown>([
        ['colours_bundle', { colours: [] }],
        ['models_index_0', { models: [] }],
      ])
    );

    const inMemory = new Map<string, unknown>([['paints_bundle', { paints: [] }]]);
    const { bundles, presentIds } = await repo.readBundlesBatch(
      ['paints_bundle', 'colours_bundle', 'models_index_0', 'missing_bundle'],
      inMemory
    );

    expect(getManySpy).toHaveBeenCalledTimes(1);
    expect(getManySpy).toHaveBeenCalledWith('bundles', [
      'colours_bundle',
      'models_index_0',
      'missing_bundle',
    ]);
    expect(bundles.get('paints_bundle')).toEqual({ paints: [] });
    expect(bundles.get('colours_bundle')).toEqual({ colours: [] });
    expect(presentIds).toEqual(new Set(['paints_bundle', 'colours_bundle', 'models_index_0']));
  });

  it('skips Firestore getDoc for models_index_* shards, staticOnly bundles, and > 950KB bundles', async () => {
    const fsSpy = spyOn(
      repo as unknown as { getFirestoreHandle: () => Promise<unknown> },
      'getFirestoreHandle'
    ).and.resolveTo(null);

    fetchSpy.and.callFake(async () => jsonResponse({ models: [] }));

    await repo.fetchMetaDoc('models_index_0', 'sha256:abc');
    await repo.fetchMetaDoc('huge_bundle', { hash: 'h', sizeBytes: 960_000 });
    await repo.fetchMetaDoc('flagged_bundle', { hash: 'h', staticOnly: true });
    expect(fsSpy).not.toHaveBeenCalled();

    await repo.fetchMetaDoc('paints_bundle', { hash: 'h', sizeBytes: 120_000 });
    expect(fsSpy).toHaveBeenCalledTimes(1);
  });

  it('reads bearer token lazily from WarhammerImportService without circular DI', async () => {
    const idbClient = (repo as unknown as {
      idb: {
        get: jasmine.Spy;
        put: jasmine.Spy;
      };
    }).idb;
    spyOn(idbClient, 'get').and.resolveTo(null);
    spyOn(idbClient, 'put').and.resolveTo();

    bearerToken = 'injected-pkce-bearer';
    fetchSpy.and.callFake(async (input) => {
      if (String(input) === '/gw-paint-api/recipes/m-api?locale=en') {
        return jsonResponse({ id: 'm-api', name: 'Live API Model', paintingAreas: [] });
      }
      return new Response('Not Found', { status: 404 });
    });

    const summary: ModelSummary | undefined = undefined;
    const recipe = await repo.getModelRecipe('m-api', summary, new Map(), new Map());
    expect(recipe?.name).toBe('Live API Model');
    const apiArgs = fetchSpy.calls
      .allArgs()
      .find((a) => a[0] === '/gw-paint-api/recipes/m-api?locale=en');
    expect((apiArgs?.[1]?.headers as Record<string, string>)['Authorization']).toBe(
      'Bearer injected-pkce-bearer'
    );
  });

  it('finds missing unchecked bundle IDs via idb.getMany and skips stale/unsafe keys', async () => {
    const idbClient = (repo as unknown as {
      idb: { getMany: jasmine.Spy };
    }).idb;
    spyOn(idbClient, 'getMany').and.resolveTo(
      new Map<string, unknown>([['present_unchecked', { ok: true }]])
    );

    const presentIds = new Set<string>(['present_checked']);
    const missing = await repo.findMissingBundleIds(
      {
        stale_bundle: 'h1',
        present_checked: 'h2',
        missing_checked: 'h3',
        present_unchecked: 'h4',
        missing_unchecked: 'h5',
        __proto__: 'evil',
      } as unknown as Record<string, string>,
      new Set(['stale_bundle']),
      new Set(['present_checked', 'missing_checked']),
      presentIds
    );

    expect(missing).toEqual(['missing_checked', 'missing_unchecked']);
    expect(presentIds.has('present_unchecked')).toBeTrue();
  });

  it('handles stale updatedAt re-fetch, offline fallback to stale cached entity, synthesis fallback, unsafe IDs, and Firestore getDoc hit/error', async () => {
    const idbClient = (repo as unknown as {
      idb: { get: jasmine.Spy; put: jasmine.Spy };
    }).idb;
    const getSpy = spyOn(idbClient, 'get').and.resolveTo(null);
    spyOn(idbClient, 'put').and.resolveTo();
    const fsSpy = spyOn(
      repo as unknown as { getFirestoreHandle: () => Promise<unknown> },
      'getFirestoreHandle'
    ).and.resolveTo(null);

    const paintMap = new Map<string, Paint>([
      [
        'p1',
        {
          id: 'p1',
          name: 'Paint One',
          range: 'warhammer_colour',
          category: 'Base',
          gradientStartHex: '#112233',
        },
      ],
    ]);
    const colorMap = new Map<string, ColorSummary>([
      [
        'c1',
        {
          id: 'c1',
          name: 'Color One',
          hex: '#112233',
          range: 'warhammer_colour',
          guideType: 'miniature',
          colorGroups: [],
          basePaintIds: ['p1'],
          detailPaintIds: [],
          artificerPaintIds: [],
          requiredPaintIds: ['p1'],
          updatedAt: '2026-11-20T00:00:00Z',
        },
      ],
    ]);
    const modelSummary: ModelSummary = {
      id: 'm-stale',
      name: 'Stale Marine',
      range: 'warhammer_colour',
      gameIds: [],
      gameNames: [],
      factionIds: [],
      factionNames: [],
      colorIds: ['c1'],
      requiredPaintIds: ['p1'],
      paintsByStage: { base: ['p1'], detail: [], artificer: [] },
      updatedAt: '2026-11-20T00:00:00Z',
    };

    // 1. Stale updatedAt triggers remote fetch; if offline, falls back to stale cached entity
    getSpy.and.resolveTo({
      id: 'm-stale',
      name: 'Cached Stale Marine',
      updatedAt: '2026-11-01T00:00:00Z',
      paintingAreas: [{ id: 'a1', name: 'Old Cached Area', paintingSteps: [] }],
    });
    fetchSpy.and.resolveTo(new Response('Not Found', { status: 404 }));
    const staleFallback = await repo.getModelRecipe('m-stale', modelSummary, colorMap, paintMap);
    expect(staleFallback?.paintingAreas[0].name).toBe('Old Cached Area');

    // 2. No cache and static+API fail -> synthesizes ModelRecipe & ColorDetails from summary
    getSpy.and.resolveTo(null);
    const synthesizedModel = await repo.getModelRecipe('m-stale', modelSummary, colorMap, paintMap);
    expect(synthesizedModel?.id).toBe('m-stale');
    expect(synthesizedModel?.paintingAreas.length).toBeGreaterThan(0);

    const synthesizedColor = await repo.getColorDetails('c1', colorMap.get('c1'), paintMap);
    expect(synthesizedColor?.id).toBe('c1');
    expect(synthesizedColor?.baseFinish?.stages[0].paint?.id).toBe('p1');

    // 3. Unsafe entity ID skips fetch/Firestore and returns null when no summary
    fetchSpy.calls.reset();
    fsSpy.calls.reset();
    expect(await repo.getModelRecipe('../evil', undefined, colorMap, paintMap)).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(fsSpy).not.toHaveBeenCalled();

    // 4. Firestore getDoc hit returns normalized recipe; Firestore error falls back to static fetch
    fsSpy.and.resolveTo({
      db: {},
      doc: (_db: unknown, _col: string, id: string) => ({ id }),
      getDoc: async () => ({
        exists: () => true,
        data: () => ({ id: 'm-fs', name: 'Firestore Marine', paintingAreas: [] }),
      }),
    });
    const fsHit = await repo.getModelRecipe('m-fs', undefined, colorMap, paintMap);
    expect(fsHit?.name).toBe('Firestore Marine');

    const warnSpy = spyOn(console, 'warn');
    fsSpy.and.resolveTo({
      db: {},
      doc: (_db: unknown, _col: string, id: string) => ({ id }),
      getDoc: async () => {
        throw new Error('permission-denied');
      },
    });
    fetchSpy.and.resolveTo(
      jsonResponse({ id: 'm-fs-err', name: 'Static Fallback Marine', paintingAreas: [] })
    );
    const fsFallback = await repo.getModelRecipe('m-fs-err', undefined, colorMap, paintMap);
    expect(fsFallback?.name).toBe('Static Fallback Marine');
    expect(warnSpy).toHaveBeenCalled();
  });
});
