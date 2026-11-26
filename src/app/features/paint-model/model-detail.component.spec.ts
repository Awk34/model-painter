import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, ParamMap, convertToParamMap, provideRouter } from '@angular/router';
import { BehaviorSubject, of } from 'rxjs';
import {
  InventoryReadinessResult,
  ModelRecipe,
  StagedReadinessResult,
  UserProject,
} from '../../core/models/catalog.models';
import { USER_LIMITS } from '../../core/config/user-limits.config';
import { CatalogService } from '../../core/services/catalog.service';
import { ImageService } from '../../core/services/image.service';
import { InventoryMatchService } from '../../core/services/inventory-match.service';
import { UserMediaService } from '../../core/services/user-media.service';
import { UserStateService } from '../../core/services/user-state.service';
import { ModelDetailComponent } from './model-detail.component';

function makeReadiness(overrides: Partial<InventoryReadinessResult> = {}): InventoryReadinessResult {
  return {
    totalRequired: 2,
    ownedDirectCount: 2,
    substitutedCount: 0,
    missingCount: 0,
    matchPercent: 100,
    ownedDirectIds: ['p1', 'p2'],
    substitutedByPaintId: {},
    missingPaintIds: [],
    ...overrides,
  };
}

const SAMPLE_STAGED: StagedReadinessResult = {
  base: makeReadiness(),
  detail: makeReadiness(),
  artificer: makeReadiness({ totalRequired: 0 }),
  overall: makeReadiness(),
};

const SAMPLE_RECIPE: ModelRecipe = {
  id: 'abaddon-the-despoiler',
  name: 'Abaddon the Despoiler',
  range: 'warhammer_colour',
  games: [{ id: 'w40k', name: 'Warhammer 40,000' }],
  factions: [{ gameId: 'w40k', gameName: 'Warhammer 40,000', factionId: 'csm', factionName: 'Chaos Space Marines' }],
  images: ['/icons/ic_models.svg', '/icons/ic_paint.svg'],
  localImagePaths: ['/icons/ic_models.svg', '/icons/ic_paint.svg'],
  colorPoints: [
    {
      id: 'cp-1',
      name: 'Burnished Gold',
      colorId: 'color-gold',
      hex: '#EDB304',
      point: { x: 0.25, y: 0.22 },
    },
    {
      id: 'cp-2',
      name: 'Abaddon Black',
      colorId: 'color-black',
      hex: '#111215',
      point: { x: 0.5, y: 0.5 },
    },
  ],
  paintingAreas: [],
};

describe('ModelDetailComponent Zoom Lightbox', () => {
  async function createComponentFixture() {
    TestBed.configureTestingModule({
      imports: [ModelDetailComponent],
      providers: [
        provideRouter([]),
        {
          provide: ActivatedRoute,
          useValue: {
            paramMap: of(convertToParamMap({ id: SAMPLE_RECIPE.id })),
          },
        },
        {
          provide: CatalogService,
          useValue: {
            modelById: signal(new Map()),
            getModelRecipe: jasmine.createSpy('getModelRecipe').and.resolveTo(SAMPLE_RECIPE),
          },
        },
        {
          provide: UserStateService,
          useValue: {
            projects: signal([]),
            uploadedPhotos: signal([]),
            allUploadedPhotos: signal([]),
            limits: USER_LIMITS,
            isModelOwned: () => false,
            isModelWishlisted: () => false,
            toggleModelInventory: () => {},
            toggleModelWishlist: () => {},
            addManyToWishlist: () => {},
            getTargetPhotoCount: () => 0,
            getPhotoQuotaLimit: () => 5,
            getPhotosForTarget: () => [],
            resolveProjectModelImageUrl: () => '/icons/ic_models.svg',
            isOwned: () => false,
            isWishlisted: () => false,
          },
        },
        {
          provide: UserMediaService,
          useValue: {
            resolvePhotoUrl: () => '/icons/ic_models.svg',
          },
        },
        {
          provide: InventoryMatchService,
          useValue: {
            evaluateStagedReadiness: () => SAMPLE_STAGED,
          },
        },
        {
          provide: ImageService,
          useValue: {
            resolve: (localPath?: string | null, remoteUrl?: string | null) =>
              localPath || remoteUrl || '/icons/ic_models.svg',
          },
        },
      ],
    });

    const fixture = TestBed.createComponent(ModelDetailComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
  }

  it('renders .photo-zoom-btn inside .img-overlay-box alongside color pins', async () => {
    const fixture = await createComponentFixture();
    const overlayBox = fixture.nativeElement.querySelector('.img-overlay-box') as HTMLElement;
    expect(overlayBox).not.toBeNull();

    const zoomBtn = overlayBox.querySelector('.photo-zoom-btn') as HTMLButtonElement;
    expect(zoomBtn).not.toBeNull();
    expect(zoomBtn.getAttribute('aria-label')).toBe('Zoom into model photo');

    const stagePins = overlayBox.querySelectorAll('.color-pin');
    expect(stagePins.length).toBe(2);
  });

  it('opens .zoom-modal-panel at 200% zoom with zero .color-pin orbs when .photo-zoom-btn is clicked', async () => {
    const fixture = await createComponentFixture();
    expect(fixture.componentInstance.showPins()).toBeTrue();
    expect(fixture.nativeElement.querySelector('.zoom-modal-panel')).toBeNull();

    const zoomBtn = fixture.nativeElement.querySelector('.photo-zoom-btn') as HTMLButtonElement;
    zoomBtn.click();
    fixture.detectChanges();

    const modal = fixture.nativeElement.querySelector('.zoom-modal-panel') as HTMLElement;
    expect(modal).not.toBeNull();

    const readout = modal.querySelector('.zoom-readout-pill') as HTMLElement;
    expect(readout.textContent?.trim()).toBe('200%');

    const modalPins = modal.querySelectorAll('.color-pin');
    expect(modalPins.length).toBe(0);

    const canvasBox = modal.querySelector('.zoom-canvas-box') as HTMLElement;
    expect(canvasBox).not.toBeNull();
    expect(canvasBox.style.transform).toContain('scale(2)');

    const zoomImg = modal.querySelector('.zoom-stage-img') as HTMLImageElement;
    expect(zoomImg).not.toBeNull();
  });

  it('toggles color-point orbs inside the zoom lightbox when clicking .zoom-pins-toggle-btn', async () => {
    const fixture = await createComponentFixture();

    const zoomBtn = fixture.nativeElement.querySelector('.photo-zoom-btn') as HTMLButtonElement;
    zoomBtn.click();
    fixture.detectChanges();

    const modal = fixture.nativeElement.querySelector('.zoom-modal-panel') as HTMLElement;
    const toggleBtn = modal.querySelector('.zoom-pins-toggle-btn') as HTMLButtonElement;
    expect(toggleBtn).not.toBeNull();
    expect(toggleBtn.getAttribute('aria-pressed')).toBe('false');
    expect(toggleBtn.textContent).toContain('Show Orbs');
    expect(modal.querySelectorAll('.color-pin').length).toBe(0);

    toggleBtn.click();
    fixture.detectChanges();
    expect(toggleBtn.getAttribute('aria-pressed')).toBe('true');
    expect(toggleBtn.textContent).toContain('Hide Orbs');
    expect(modal.querySelectorAll('.color-pin').length).toBe(2);

    toggleBtn.click();
    fixture.detectChanges();
    expect(toggleBtn.getAttribute('aria-pressed')).toBe('false');
    expect(toggleBtn.textContent).toContain('Show Orbs');
    expect(modal.querySelectorAll('.color-pin').length).toBe(0);
  });

  it('supports zoomIn(), zoomOut(), resetZoom(), and closeZoomModal()', async () => {
    const fixture = await createComponentFixture();
    const component = fixture.componentInstance;

    component.openZoomModal();
    fixture.detectChanges();
    expect(component.zoomModalOpen()).toBeTrue();
    expect(component.zoomScale()).toBe(2);

    component.zoomIn();
    fixture.detectChanges();
    expect(component.zoomScale()).toBe(2.5);
    expect(fixture.nativeElement.querySelector('.zoom-readout-pill')?.textContent?.trim()).toBe('250%');

    component.zoomIn();
    component.zoomIn();
    component.zoomIn();
    component.zoomIn();
    expect(component.zoomScale()).toBe(4);

    component.zoomOut();
    fixture.detectChanges();
    expect(component.zoomScale()).toBe(3.5);

    component.panX.set(40);
    component.panY.set(-25);
    component.resetZoom();
    fixture.detectChanges();
    expect(component.zoomScale()).toBe(1);
    expect(component.panX()).toBe(0);
    expect(component.panY()).toBe(0);
    expect(fixture.nativeElement.querySelector('.zoom-readout-pill')?.textContent?.trim()).toBe('100%');

    component.closeZoomModal();
    fixture.detectChanges();
    expect(component.zoomModalOpen()).toBeFalse();
    expect(fixture.nativeElement.querySelector('.zoom-modal-panel')).toBeNull();
  });

  it('opens zoom modal inside native <dialog>, supports keyboard zoom/pan shortcuts, and uses non-nested .cp-card links', async () => {
    const fixture = await createComponentFixture();
    const component = fixture.componentInstance;
    const root = fixture.nativeElement as HTMLElement;

    const cpCards = root.querySelectorAll('.cp-card');
    expect(cpCards.length).toBe(2);
    expect(root.querySelectorAll('.cp-card button a, .cp-card a button, .cp-card button button').length).toBe(0);
    expect(root.querySelector('.colors-on-model h2')?.textContent).toContain('Colors On This Model');

    component.openZoomModal();
    fixture.detectChanges();

    const dialog = root.querySelector('app-modal-dialog.zoom-modal-dialog dialog') as HTMLDialogElement;
    expect(dialog.open).toBeTrue();
    expect(dialog.matches(':modal')).toBeTrue();
    expect(dialog.getAttribute('aria-labelledby')).toBe('zoom-modal-title');

    // Keyboard zoom & pan
    dialog.dispatchEvent(new KeyboardEvent('keydown', { key: '+', bubbles: true }));
    expect(component.zoomScale()).toBe(2.5);

    dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    expect(component.panX()).toBe(32);

    dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    expect(component.panY()).toBe(32);

    dialog.dispatchEvent(new KeyboardEvent('keydown', { key: '0', bubbles: true }));
    expect(component.zoomScale()).toBe(1);
    expect(component.panX()).toBe(0);
    expect(component.panY()).toBe(0);
  });
});

describe('ModelDetailComponent Project-Model Route Mode', () => {
  it('renders custom label, quantity, notes, and hides official color pins when viewing custom featured image', async () => {
    const projectSignal = signal<UserProject[]>([
      {
        id: 'proj_1',
        name: 'Iron Hands Spearhead',
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-02T00:00:00Z',
        colorIds: [],
        notes: [],
        photos: [],
        models: [
          {
            id: 'pmod_plasma',
            recipeId: SAMPLE_RECIPE.id,
            customName: 'Redemptor — Macro Plasma',
            quantity: 2,
            notes: 'Magnetize plasma arm',
            completedStepIds: ['step-1'],
            featuredImage: {
              source: 'catalog_model',
              modelId: 'other-model',
              localImagePath: '/icons/ic_paint.svg',
            },
            photos: [],
            createdAt: '2026-01-01T00:00:00Z',
            updatedAt: '2026-01-02T00:00:00Z',
          },
        ],
      },
    ]);

    TestBed.configureTestingModule({
      imports: [ModelDetailComponent],
      providers: [
        provideRouter([]),
        {
          provide: ActivatedRoute,
          useValue: {
            paramMap: of(convertToParamMap({ projectId: 'proj_1', entryId: 'pmod_plasma' })),
          },
        },
        {
          provide: CatalogService,
          useValue: {
            modelById: signal(new Map()),
            models: signal([]),
            getModelRecipe: jasmine.createSpy('getModelRecipe').and.resolveTo(SAMPLE_RECIPE),
          },
        },
        {
          provide: UserStateService,
          useValue: {
            projects: projectSignal,
            uploadedPhotos: signal([]),
            allUploadedPhotos: signal([]),
            limits: USER_LIMITS,
            isModelOwned: () => false,
            isModelWishlisted: () => false,
            toggleModelInventory: () => {},
            toggleModelWishlist: () => {},
            addManyToWishlist: () => {},
            getTargetPhotoCount: () => 0,
            getPhotoQuotaLimit: () => 5,
            getPhotosForTarget: () => [],
            resolveProjectModelImageUrl: () => '/icons/ic_paint.svg',
            getProjectModelCompletedStepIds: () => ['step-1'],
            updateProjectModel: jasmine.createSpy('updateProjectModel'),
            setProjectModelQuantity: jasmine.createSpy('setProjectModelQuantity'),
            setProjectModelFeaturedImage: jasmine.createSpy('setProjectModelFeaturedImage'),
            isOwned: () => false,
            isWishlisted: () => false,
          },
        },
        {
          provide: UserMediaService,
          useValue: {
            resolvePhotoUrl: () => '/icons/ic_models.svg',
          },
        },
        {
          provide: InventoryMatchService,
          useValue: {
            evaluateStagedReadiness: () => SAMPLE_STAGED,
          },
        },
        {
          provide: ImageService,
          useValue: {
            resolve: (localPath?: string | null, remoteUrl?: string | null) =>
              localPath || remoteUrl || '/icons/ic_models.svg',
          },
        },
      ],
    });

    const fixture = TestBed.createComponent(ModelDetailComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const comp = fixture.componentInstance;
    expect(comp.isProjectMode()).toBeTrue();
    expect(comp.viewingCustomFeatured()).toBeTrue();
    expect(comp.canShowColorPins()).toBeFalse();
    expect(comp.activeImageUrl()).toBe('/icons/ic_paint.svg');
    expect(fixture.nativeElement.textContent).toContain('Redemptor — Macro Plasma');
    expect(fixture.nativeElement.querySelectorAll('.color-pin').length).toBe(0);

    // Switching to Official Angle 1 restores official color pins
    comp.selectOfficialAngleView(0);
    fixture.detectChanges();
    expect(comp.viewingCustomFeatured()).toBeFalse();
    expect(comp.canShowColorPins()).toBeTrue();
    expect(fixture.nativeElement.querySelectorAll('.color-pin').length).toBe(2);
  });
});

describe('ModelDetailComponent User Photo Thumbnails', () => {
  it('shows clickable thumbnails for user showcase and reference photos under the main photo even when recipe has only 1 official image', async () => {
    const singleImageRecipe: ModelRecipe = {
      ...SAMPLE_RECIPE,
      images: ['/icons/ic_models.svg'],
      localImagePaths: ['/icons/ic_models.svg'],
    };

    const showcasePhoto = {
      id: 'ph_showcase_1',
      targetType: 'model' as const,
      targetId: singleImageRecipe.id,
      kind: 'showcase' as const,
      fileName: 'dante-wip.png',
      caption: 'Gold armor WIP',
      mimeType: 'image/png' as const,
      sizeBytes: 1024,
      createdAt: '2026-11-23T00:00:00Z',
    };

    const refPhoto = {
      id: 'ph_ref_1',
      targetType: 'model' as const,
      targetId: singleImageRecipe.id,
      kind: 'reference' as const,
      fileName: 'nmm-ref.png',
      mimeType: 'image/png' as const,
      sizeBytes: 2048,
      createdAt: '2026-11-23T00:01:00Z',
    };

    TestBed.configureTestingModule({
      imports: [ModelDetailComponent],
      providers: [
        provideRouter([]),
        {
          provide: ActivatedRoute,
          useValue: {
            paramMap: of(convertToParamMap({ id: singleImageRecipe.id })),
          },
        },
        {
          provide: CatalogService,
          useValue: {
            modelById: signal(new Map()),
            getModelRecipe: jasmine.createSpy('getModelRecipe').and.resolveTo(singleImageRecipe),
          },
        },
        {
          provide: UserStateService,
          useValue: {
            projects: signal([]),
            uploadedPhotos: signal([showcasePhoto, refPhoto]),
            allUploadedPhotos: signal([showcasePhoto, refPhoto]),
            limits: USER_LIMITS,
            isModelOwned: () => false,
            isModelWishlisted: () => false,
            toggleModelInventory: () => {},
            toggleModelWishlist: () => {},
            addManyToWishlist: () => {},
            getTargetPhotoCount: () => 2,
            getPhotoQuotaLimit: () => 8,
            getPhotosForTarget: (_t: string, _id: string, kind: string) =>
              kind === 'showcase' ? [showcasePhoto] : [refPhoto],
            resolveProjectModelImageUrl: () => '/icons/ic_models.svg',
            isOwned: () => false,
            isWishlisted: () => false,
          },
        },
        {
          provide: UserMediaService,
          useValue: {
            resolvePhotoUrl: (ph: { id: string }) => `blob:test/${ph.id}`,
          },
        },
        {
          provide: InventoryMatchService,
          useValue: {
            evaluateStagedReadiness: () => SAMPLE_STAGED,
          },
        },
        {
          provide: ImageService,
          useValue: {
            resolve: (localPath?: string | null, remoteUrl?: string | null) =>
              localPath || remoteUrl || '/icons/ic_models.svg',
          },
        },
      ],
    });

    const fixture = TestBed.createComponent(ModelDetailComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const thumbs = fixture.nativeElement.querySelectorAll(
      '.viewer-controls .angle-thumb'
    ) as NodeListOf<HTMLButtonElement>;
    // 1 official angle + 1 showcase photo + 1 private reference photo
    expect(thumbs.length).toBe(3);

    const userThumbs = fixture.nativeElement.querySelectorAll(
      '.viewer-controls .user-angle-thumb'
    ) as NodeListOf<HTMLButtonElement>;
    expect(userThumbs.length).toBe(2);
    expect(userThumbs[1].classList.contains('ref-angle-thumb')).toBeTrue();

    // Clicking the user showcase thumbnail displays it in the main stage and hides official color pins
    userThumbs[0].click();
    fixture.detectChanges();
    expect(fixture.componentInstance.activeImageUrl()).toBe('blob:test/ph_showcase_1');
    expect(fixture.componentInstance.canShowColorPins()).toBeFalse();
    expect(fixture.nativeElement.querySelectorAll('.color-pin').length).toBe(0);

    // Clicking back on the official thumbnail restores the official image & color pins
    thumbs[0].click();
    fixture.detectChanges();
    expect(fixture.componentInstance.activeImageUrl()).toBe('/icons/ic_models.svg');
    expect(fixture.componentInstance.canShowColorPins()).toBeTrue();
    expect(fixture.nativeElement.querySelectorAll('.color-pin').length).toBe(2);
  });
});

describe('ModelDetailComponent Error & Not-Found States', () => {
  async function createWithRecipeResult(getRecipeImpl: jasmine.Spy) {
    TestBed.configureTestingModule({
      imports: [ModelDetailComponent],
      providers: [
        provideRouter([]),
        {
          provide: ActivatedRoute,
          useValue: {
            paramMap: of(convertToParamMap({ id: 'invalid-model-id' })),
          },
        },
        {
          provide: CatalogService,
          useValue: {
            modelById: signal(new Map()),
            getModelRecipe: getRecipeImpl,
          },
        },
        {
          provide: UserStateService,
          useValue: {
            projects: signal([]),
            uploadedPhotos: signal([]),
            allUploadedPhotos: signal([]),
            limits: USER_LIMITS,
            isModelOwned: () => false,
            isModelWishlisted: () => false,
            toggleModelInventory: () => {},
            toggleModelWishlist: () => {},
            addManyToWishlist: () => {},
            getTargetPhotoCount: () => 0,
            getPhotoQuotaLimit: () => 5,
            getPhotosForTarget: () => [],
            resolveProjectModelImageUrl: () => '/icons/ic_models.svg',
            isOwned: () => false,
            isWishlisted: () => false,
          },
        },
        {
          provide: UserMediaService,
          useValue: {
            resolvePhotoUrl: () => '/icons/ic_models.svg',
          },
        },
        {
          provide: InventoryMatchService,
          useValue: {
            evaluateStagedReadiness: () => SAMPLE_STAGED,
          },
        },
        {
          provide: ImageService,
          useValue: {
            resolve: (localPath?: string | null, remoteUrl?: string | null) =>
              localPath || remoteUrl || '/icons/ic_models.svg',
          },
        },
      ],
    });

    const fixture = TestBed.createComponent(ModelDetailComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
  }

  it('clears loading() and renders error state with <h1> when getModelRecipe rejects', async () => {
    spyOn(console, 'warn');
    const fixture = await createWithRecipeResult(
      jasmine.createSpy('getModelRecipe').and.rejectWith(new Error('Fetch failed'))
    );

    expect(fixture.componentInstance.loading()).toBeFalse();
    expect(fixture.componentInstance.loadError()).toBeTruthy();

    const alertEl: HTMLElement | null = fixture.nativeElement.querySelector('[role="alert"]');
    expect(alertEl).not.toBeNull();
    expect(alertEl?.querySelector('h1')?.textContent).toContain('Model Guide Unavailable');
  });

  it('renders standalone not-found @else state with <h1> and /models link when getModelRecipe returns null', async () => {
    const fixture = await createWithRecipeResult(
      jasmine.createSpy('getModelRecipe').and.resolveTo(null)
    );

    expect(fixture.componentInstance.loading()).toBeFalse();
    expect(fixture.componentInstance.recipe()).toBeNull();
    expect(fixture.nativeElement.querySelector('h1')?.textContent).toContain(
      'Model Guide Not Found'
    );
    const links = Array.from(
      fixture.nativeElement.querySelectorAll('a') as NodeListOf<HTMLAnchorElement>
    );
    expect(links.some((a) => a.getAttribute('href')?.includes('/models'))).toBeTrue();
  });
});

describe('ModelDetailComponent Async Re-Entry Race & Route Transitions', () => {
  function createHarness(
    initialParams: Record<string, string>,
    getRecipeImpl: jasmine.Spy,
    projects: UserProject[] = []
  ) {
    const paramMap$ = new BehaviorSubject<ParamMap>(convertToParamMap(initialParams));
    TestBed.configureTestingModule({
      imports: [ModelDetailComponent],
      providers: [
        provideRouter([]),
        {
          provide: ActivatedRoute,
          useValue: { paramMap: paramMap$.asObservable() },
        },
        {
          provide: CatalogService,
          useValue: {
            modelById: signal(new Map()),
            getModelRecipe: getRecipeImpl,
          },
        },
        {
          provide: UserStateService,
          useValue: {
            projects: signal(projects),
            uploadedPhotos: signal([]),
            allUploadedPhotos: signal([]),
            limits: USER_LIMITS,
            isModelOwned: () => false,
            isModelWishlisted: () => false,
            toggleModelInventory: () => {},
            toggleModelWishlist: () => {},
            addManyToWishlist: () => {},
            getTargetPhotoCount: () => 0,
            getPhotoQuotaLimit: () => 5,
            getPhotosForTarget: () => [],
            resolveProjectModelImageUrl: () => '/icons/ic_models.svg',
            getProjectModelCompletedStepIds: () => [],
            isOwned: () => false,
            isWishlisted: () => false,
          },
        },
        {
          provide: UserMediaService,
          useValue: {
            resolvePhotoUrl: () => '/icons/ic_models.svg',
          },
        },
        {
          provide: InventoryMatchService,
          useValue: {
            evaluateStagedReadiness: () => SAMPLE_STAGED,
          },
        },
        {
          provide: ImageService,
          useValue: {
            resolve: (localPath?: string | null, remoteUrl?: string | null) =>
              localPath || remoteUrl || '/icons/ic_models.svg',
          },
        },
      ],
    });

    const fixture = TestBed.createComponent(ModelDetailComponent);
    return { fixture, paramMap$ };
  }

  it('ignores late resolution of an earlier request during A -> B -> A re-entry', async () => {
    let resolveFirstA!: (val: ModelRecipe | null) => void;
    let callNum = 0;
    const getRecipeSpy = jasmine.createSpy('getModelRecipe').and.callFake((id: string) => {
      callNum++;
      if (id === 'model-a' && callNum === 1) {
        return new Promise<ModelRecipe | null>((res) => {
          resolveFirstA = res;
        });
      }
      if (id === 'model-b') {
        return Promise.resolve({ ...SAMPLE_RECIPE, id: 'model-b', name: 'Model B' });
      }
      return Promise.resolve({ ...SAMPLE_RECIPE, id: 'model-a', name: 'Model A Fresh' });
    });

    const { fixture, paramMap$ } = createHarness({ id: 'model-a' }, getRecipeSpy);
    fixture.detectChanges();

    paramMap$.next(convertToParamMap({ id: 'model-b' }));
    fixture.detectChanges();

    paramMap$.next(convertToParamMap({ id: 'model-a' }));
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.componentInstance.recipe()?.name).toBe('Model A Fresh');
    expect(fixture.componentInstance.loading()).toBeFalse();

    // Now resolve the stale first request for model-a
    resolveFirstA({ ...SAMPLE_RECIPE, id: 'model-a', name: 'Model A STALE' });
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.componentInstance.recipe()?.name).toBe('Model A Fresh');
    expect(fixture.componentInstance.loadError()).toBeNull();
    expect(fixture.componentInstance.loading()).toBeFalse();
  });

  it('ignores late rejection of an earlier request during A -> B -> A re-entry', async () => {
    spyOn(console, 'warn');
    let rejectFirstA!: (err: unknown) => void;
    let callNum = 0;
    const getRecipeSpy = jasmine.createSpy('getModelRecipe').and.callFake((id: string) => {
      callNum++;
      if (id === 'model-a' && callNum === 1) {
        return new Promise<ModelRecipe | null>((_res, rej) => {
          rejectFirstA = rej;
        });
      }
      if (id === 'model-b') {
        return Promise.resolve({ ...SAMPLE_RECIPE, id: 'model-b', name: 'Model B' });
      }
      return Promise.resolve({ ...SAMPLE_RECIPE, id: 'model-a', name: 'Model A Fresh' });
    });

    const { fixture, paramMap$ } = createHarness({ id: 'model-a' }, getRecipeSpy);
    fixture.detectChanges();

    paramMap$.next(convertToParamMap({ id: 'model-b' }));
    fixture.detectChanges();

    paramMap$.next(convertToParamMap({ id: 'model-a' }));
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.componentInstance.recipe()?.name).toBe('Model A Fresh');

    // Now reject the stale first request for model-a
    rejectFirstA(new Error('Stale network error'));
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.componentInstance.recipe()?.name).toBe('Model A Fresh');
    expect(fixture.componentInstance.loadError()).toBeNull();
    expect(fixture.componentInstance.loading()).toBeFalse();
    expect(fixture.nativeElement.querySelector('[role="alert"]')).toBeNull();
  });

  it('resets selectedImageIndex to 0 when navigating from project-model mode to standalone mode on the same recipeId', async () => {
    const projects: UserProject[] = [
      {
        id: 'proj_1',
        name: 'Project One',
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
        colorIds: [],
        notes: [],
        photos: [],
        models: [
          {
            id: 'pmod_1',
            recipeId: SAMPLE_RECIPE.id,
            quantity: 1,
            notes: '',
            completedStepIds: [],
            featuredImage: { source: 'catalog_angle', imageIndex: 1 },
            photos: [],
            createdAt: '2026-01-01T00:00:00Z',
            updatedAt: '2026-01-01T00:00:00Z',
          },
        ],
      },
    ];
    const getRecipeSpy = jasmine.createSpy('getModelRecipe').and.resolveTo(SAMPLE_RECIPE);
    const { fixture, paramMap$ } = createHarness(
      { projectId: 'proj_1', entryId: 'pmod_1' },
      getRecipeSpy,
      projects
    );
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.componentInstance.isProjectMode()).toBeTrue();
    expect(fixture.componentInstance.selectedImageIndex()).toBe(1);

    paramMap$.next(convertToParamMap({ id: SAMPLE_RECIPE.id }));
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.componentInstance.isProjectMode()).toBeFalse();
    expect(fixture.componentInstance.selectedImageIndex()).toBe(0);
    expect(fixture.componentInstance.viewingCustomFeatured()).toBeFalse();
  });
});
