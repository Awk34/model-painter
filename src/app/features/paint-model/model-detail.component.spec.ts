import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { of } from 'rxjs';
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
