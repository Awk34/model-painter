import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ModelPaintingStepsComponent } from '../../features/paint-model/components/model-painting-steps.component';
import { CatalogService, normalizePaintingStageLabel } from './catalog.service';
import { InventoryMatchService } from './inventory-match.service';
import { UserStateService } from './user-state.service';

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('CatalogService', () => {
  let fetchSpy: jasmine.Spy<typeof window.fetch>;
  let routeResponses: Map<string, () => Response>;

  beforeEach(async () => {
    localStorage.removeItem('whc_pkce_token_cache');
    sessionStorage.removeItem('whc_pkce_token_cache');

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

  afterEach(() => {
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
    const service = TestBed.inject(CatalogService);
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
    const service = TestBed.inject(CatalogService);
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
    localStorage.setItem(
      'whc_pkce_token_cache',
      JSON.stringify({ code: 'abc', bearer: 'test-bearer-token' })
    );

    const service = TestBed.inject(CatalogService);
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
});

describe('ModelPaintingStepsComponent stage filtering', () => {
  it('filters both normalized and raw paintingStage values', () => {
    TestBed.configureTestingModule({
      imports: [ModelPaintingStepsComponent],
      providers: [
        {
          provide: UserStateService,
          useValue: {
            isOwned: () => false,
            isWishlisted: () => false,
            toggleInventory: () => undefined,
            toggleWishlist: () => undefined,
          },
        },
        {
          provide: InventoryMatchService,
          useValue: {},
        },
        {
          provide: CatalogService,
          useValue: {
            paints: signal([]),
            paintById: signal(new Map()),
          },
        },
      ],
    });

    const fixture = TestBed.createComponent(ModelPaintingStepsComponent);
    const comp = fixture.componentInstance;
    const steps = [
      { id: 's1', stepOrder: 1, stepNumber: 1, paintingStage: 'base' },
      { id: 's2', stepOrder: 2, stepNumber: 2, paintingStage: 'Detail Finish' },
      { id: 's3', stepOrder: 3, stepNumber: 3, paintingStage: 'artificer' },
    ];

    comp.stageFilter.set('Base Finish');
    expect(comp.filterSteps(steps).map((s) => s.id)).toEqual(['s1']);

    comp.stageFilter.set('Detail Finish');
    expect(comp.filterSteps(steps).map((s) => s.id)).toEqual(['s2']);

    comp.stageFilter.set('Artificer Finish');
    expect(comp.filterSteps(steps).map((s) => s.id)).toEqual(['s3']);

    comp.stageFilter.set('all');
    expect(comp.filterSteps(steps).map((s) => s.id)).toEqual(['s1', 's2', 's3']);
  });
});
