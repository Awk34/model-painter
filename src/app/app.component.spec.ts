import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AppComponent } from './app.component';
import { CatalogSyncStatus, CloudSyncStatus } from './core/models/catalog.models';
import { CatalogService } from './core/services/catalog.service';
import { ImageService } from './core/services/image.service';
import { PaintModalService } from './core/services/paint-modal.service';
import { ToastService } from './core/services/toast.service';
import { UserStateService } from './core/services/user-state.service';

describe('AppComponent', () => {
  let fixture: ComponentFixture<AppComponent>;
  let toastService: ToastService;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AppComponent],
      providers: [
        provideRouter([]),
        ToastService,
        {
          provide: CatalogService,
          useValue: {
            models: signal([]),
            colors: signal([]),
            paints: signal([]),
            thirdPartyPaints: signal([]),
            thirdPartyBrands: signal([]),
            paintById: signal(new Map()),
            thirdPartyById: signal(new Map()),
            loading: signal(false),
            syncStatus: signal(CatalogSyncStatus.UpToDate),
          },
        },
        {
          provide: PaintModalService,
          useValue: {
            activePaintId: signal<string | null>(null),
          },
        },
        {
          provide: ImageService,
          useValue: {
            resolve: () => '/icons/ic_models.svg',
          },
        },
        {
          provide: UserStateService,
          useFactory: () => {
            const toast = TestBed.inject(ToastService);
            return {
              projects: signal([]),
              state: signal({
                inventoryPaintIds: [],
                wishlistPaintIds: [],
                inventoryModelIds: [],
                wishlistModelIds: [],
                projects: [],
                customPaints: [],
                customCompatibilityOverrides: {},
                uploadedPhotos: [],
                preferences: {
                  allowCompatibleSubstitutions: true,
                  allowThirdPartySubstitutions: true,
                },
              }),
              currentUser: signal(null),
              cloudSyncStatus: signal(CloudSyncStatus.LocalOnly),
              toastMessage: toast.message,
              isOwned: () => false,
              isWishlisted: () => false,
            };
          },
        },
      ],
    }).compileComponents();

    toastService = TestBed.inject(ToastService);
    fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();
  });

  afterEach(() => {
    fixture?.destroy();
    TestBed.resetTestingModule();
  });

  it('renders currentColor inline SVG icons in desktop and mobile navigation with zero static icon <img> tags', () => {
    const root = fixture.nativeElement as HTMLElement;
    const legacyIconImgs = root.querySelectorAll(
      'img[src*="ic_hobby_desk"], img[src*="ic_models"], img[src*="ic_color"], img[src*="ic_search"], img[src*="ic_profile"]'
    );
    expect(legacyIconImgs.length).toBe(0);

    const sideNavSvgs = Array.from(root.querySelectorAll('.side-nav svg')) as SVGElement[];
    const mobileNavSvgs = Array.from(
      root.querySelectorAll('.mobile-bottom-nav svg')
    ) as SVGElement[];

    expect(sideNavSvgs.length).toBeGreaterThanOrEqual(4);
    expect(mobileNavSvgs.length).toBeGreaterThanOrEqual(5);

    for (const svg of [...sideNavSvgs, ...mobileNavSvgs]) {
      expect(svg.getAttribute('fill')).toBe('currentColor');
      expect(getComputedStyle(svg).color).not.toBe('rgb(0, 0, 0)');
    }
  });

  it('mounts a persistent notification region and toggles popover="manual" with pause and dismiss', () => {
    const root = fixture.nativeElement as HTMLElement;
    expect(root.isConnected).toBeTrue();

    const region = root.querySelector('[role="region"][aria-label="Notifications"]') as HTMLElement | null;
    const liveRegion = region?.querySelector('[aria-live="polite"]') as HTMLElement | null;
    const popoverEl = region?.querySelector('[popover="manual"]') as HTMLElement | null;

    expect(region).toBeTruthy();
    expect(liveRegion).toBeTruthy();
    expect(popoverEl).toBeTruthy();
    expect(popoverEl?.matches(':popover-open')).toBeFalse();

    toastService.show('Paint added');
    fixture.detectChanges();

    expect(liveRegion?.textContent?.trim()).toBe('Paint added');
    expect(popoverEl?.matches(':popover-open')).toBeTrue();

    const closeBtn = popoverEl?.querySelector(
      'button[type="button"][aria-label="Dismiss notification"]'
    ) as HTMLButtonElement | null;
    expect(closeBtn).toBeTruthy();

    popoverEl?.dispatchEvent(new MouseEvent('mouseenter'));
    expect(toastService.isPaused()).toBeTrue();

    popoverEl?.dispatchEvent(new MouseEvent('mouseleave'));
    expect(toastService.isPaused()).toBeFalse();

    closeBtn?.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    expect(toastService.isPaused()).toBeTrue();

    closeBtn?.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: null }));
    expect(toastService.isPaused()).toBeFalse();

    closeBtn?.click();
    fixture.detectChanges();

    expect(toastService.message()).toBeNull();
    expect(popoverEl?.matches(':popover-open')).toBeFalse();
  });
});
