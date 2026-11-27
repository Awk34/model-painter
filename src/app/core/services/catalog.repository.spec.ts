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
});
