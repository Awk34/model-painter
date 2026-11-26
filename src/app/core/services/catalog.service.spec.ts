import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ModelPaintingStepsComponent } from '../../features/paint-model/components/model-painting-steps.component';
import { KNOWN_THIRD_PARTY_BRANDS } from '../models/catalog.models';
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

    const service = TestBed.inject(CatalogService);
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

    const service = TestBed.inject(CatalogService);
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

    const service = TestBed.inject(CatalogService);
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
    const service = TestBed.inject(CatalogService);
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
    const idbClient = (service as unknown as { idb: { put: jasmine.Spy } }).idb;
    spyOn(idbClient, 'put').and.rejectWith(new DOMException('Quota exceeded', 'QuotaExceededError'));

    const recipe = await service.getModelRecipe('model-dante');
    expect(recipe).not.toBeNull();
    expect(recipe!.id).toBe('model-dante');
  });
});

describe('ModelPaintingStepsComponent stage filtering', () => {
  function configureStepsTestingModule() {
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
  }

  it('filters both normalized and raw paintingStage values', () => {
    configureStepsTestingModule();

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

  it('renders metallic gradient background and .metallic class on metallic step swatches', () => {
    configureStepsTestingModule();

    const fixture = TestBed.createComponent(ModelPaintingStepsComponent);
    fixture.componentRef.setInput('paintingAreas', [
      {
        id: 'area-base',
        areaOrder: 1,
        name: 'Base Finish',
        paintingSteps: [
          {
            id: 'step-gold',
            stepOrder: 1,
            stepNumber: 6,
            paintingStage: 'Base Finish',
            techniqueName: 'Basecoat',
            text: '• Gold areas',
            paint: {
              id: 'paint-retributor',
              name: 'Retributor Armour',
              category: 'base',
              potStyle: 'metallic',
              gradientStartHex: '#FFFFFF',
              gradientMiddleHex: '#EBB854',
              gradientEndHex: '#89571D',
            },
          },
          {
            id: 'step-black',
            stepOrder: 2,
            stepNumber: 7,
            paintingStage: 'Base Finish',
            techniqueName: 'Basecoat',
            text: '• Black areas',
            paint: {
              id: 'paint-abaddon',
              name: 'Abaddon Black',
              category: 'base',
              potStyle: 'flat',
              gradientStartHex: '#000000',
            },
          },
          {
            id: 'step-shade',
            stepOrder: 3,
            stepNumber: 9,
            paintingStage: 'Base Finish',
            techniqueName: 'Shade',
            text: '• Gold areas',
            paint: {
              id: 'paint-reikland',
              name: 'Reikland Fleshshade',
              category: 'shade',
              potStyle: 'shade',
              gradientStartHex: '#FFD5B7',
              gradientMiddleHex: '#AC491D',
              gradientEndHex: '#311908',
            },
          },
        ],
      },
    ]);
    fixture.componentRef.setInput('readiness', {
      totalRequired: 3,
      ownedDirectCount: 0,
      substitutedCount: 0,
      missingCount: 3,
      matchPercent: 0,
      ownedDirectIds: [],
      substitutedByPaintId: {},
      missingPaintIds: ['paint-retributor', 'paint-abaddon', 'paint-reikland'],
    });
    fixture.detectChanges();

    const swatches = Array.from(
      fixture.nativeElement.querySelectorAll('.paint-swatch')
    ) as HTMLElement[];
    expect(swatches.length).toBe(3);

    const goldSwatch = swatches[0];
    expect(goldSwatch.classList.contains('metallic')).toBeTrue();
    expect(goldSwatch.classList.contains('shade')).toBeFalse();
    const goldBg = goldSwatch.style.background || goldSwatch.style.backgroundImage;
    expect(goldBg).toContain('linear-gradient');
    expect(goldBg).toContain('235, 184, 84'); // #EBB854 in rgb

    const blackSwatch = swatches[1];
    expect(blackSwatch.classList.contains('metallic')).toBeFalse();
    expect(blackSwatch.classList.contains('shade')).toBeFalse();
    expect(blackSwatch.style.background).toContain('rgb(0, 0, 0)');

    const shadeSwatch = swatches[2];
    expect(shadeSwatch.classList.contains('shade')).toBeTrue();
    expect(shadeSwatch.classList.contains('metallic')).toBeFalse();
    const shadeBg = shadeSwatch.style.background || shadeSwatch.style.backgroundImage;
    expect(shadeBg).toContain('linear-gradient');
    expect(shadeBg).toContain('172, 73, 29'); // #AC491D in rgb
  });

  it('tracks individual color area steps and whole stage completion', () => {
    const progressSignal = signal<Record<string, string[]>>({});
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
            getCompletedStepIds: (modelId: string) => progressSignal()[modelId] ?? [],
            toggleStepDone: (modelId: string, stepId: string) => {
              const cur = new Set(progressSignal()[modelId] ?? []);
              if (cur.has(stepId)) cur.delete(stepId);
              else cur.add(stepId);
              progressSignal.set({ ...progressSignal(), [modelId]: Array.from(cur) });
            },
            setStepsDone: (modelId: string, stepIds: string[], done: boolean) => {
              const cur = new Set(progressSignal()[modelId] ?? []);
              for (const id of stepIds) {
                if (done) cur.add(id);
                else cur.delete(id);
              }
              progressSignal.set({ ...progressSignal(), [modelId]: Array.from(cur) });
            },
            clearModelProgress: (modelId: string) => {
              const next = { ...progressSignal() };
              delete next[modelId];
              progressSignal.set(next);
            },
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
    const baseArea = {
      id: 'area-base',
      areaOrder: 1,
      name: 'Base Finish',
      paintingSteps: [
        { id: 'step-1', stepOrder: 1, stepNumber: 1, paintingStage: 'Base Finish', text: '• Blue areas' },
        { id: 'step-2', stepOrder: 2, stepNumber: 2, paintingStage: 'Base Finish', text: '• Gold areas' },
      ],
    };
    fixture.componentRef.setInput('modelId', 'model-1');
    fixture.componentRef.setInput('paintingAreas', [baseArea]);
    fixture.componentRef.setInput('readiness', {
      totalRequired: 0,
      ownedDirectCount: 0,
      substitutedCount: 0,
      missingCount: 0,
      matchPercent: 100,
      ownedDirectIds: [],
      substitutedByPaintId: {},
      missingPaintIds: [],
    });
    fixture.detectChanges();

    expect(comp.overallProgress()).toEqual({ done: 0, total: 2, isDone: false, percent: 0 });
    expect(comp.getAreaProgress(baseArea)).toEqual({ done: 0, total: 2, isDone: false });

    const stageBtn = fixture.nativeElement.querySelector(
      '.stage-done-btn'
    ) as HTMLButtonElement;
    const stepBtns = Array.from(
      fixture.nativeElement.querySelectorAll('.step-done-btn')
    ) as HTMLButtonElement[];
    expect(stageBtn).toBeTruthy();
    expect(stageBtn.title).toContain('Mark stage done: Base Finish');
    expect(stepBtns.length).toBe(2);
    expect(stepBtns[0].title).toContain('Mark done: • Blue areas');

    // Mark an individual color area step done
    stepBtns[0].click();
    fixture.detectChanges();
    expect(comp.isStepDone('step-1')).toBeTrue();
    expect(comp.isStepDone('step-2')).toBeFalse();
    expect(stepBtns[0].getAttribute('aria-pressed')).toBe('true');
    expect(stageBtn.classList.contains('partial')).toBeTrue();
    expect(comp.overallProgress()).toEqual({ done: 1, total: 2, isDone: false, percent: 50 });

    // Mark entire stage done
    stageBtn.click();
    fixture.detectChanges();
    expect(comp.isStepDone('step-1')).toBeTrue();
    expect(comp.isStepDone('step-2')).toBeTrue();
    expect(stageBtn.getAttribute('aria-pressed')).toBe('true');
    expect(stageBtn.classList.contains('done')).toBeTrue();
    expect(stageBtn.classList.contains('partial')).toBeFalse();
    expect(comp.getAreaProgress(baseArea)).toEqual({ done: 2, total: 2, isDone: true });
    expect(comp.overallProgress()).toEqual({ done: 2, total: 2, isDone: true, percent: 100 });

    // Toggle stage off
    stageBtn.click();
    fixture.detectChanges();
    expect(stageBtn.getAttribute('aria-pressed')).toBe('false');
    expect(comp.overallProgress()).toEqual({ done: 0, total: 2, isDone: false, percent: 0 });
  });
});
