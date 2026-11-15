import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { of } from 'rxjs';
import {
  InventoryReadinessResult,
  ModelRecipe,
  StagedReadinessResult,
} from '../../core/models/catalog.models';
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
            isModelOwned: () => false,
            isModelWishlisted: () => false,
            toggleModelInventory: () => {},
            toggleModelWishlist: () => {},
            addManyToWishlist: () => {},
            getTargetPhotoCount: () => 0,
            getPhotoQuotaLimit: () => 5,
            getPhotosForTarget: () => [],
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
