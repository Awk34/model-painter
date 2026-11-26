import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { USER_LIMITS } from '../../core/config/user-limits.config';
import { CatalogService } from '../../core/services/catalog.service';
import { ImageService } from '../../core/services/image.service';
import { InventoryMatchService } from '../../core/services/inventory-match.service';
import { PaintModalService } from '../../core/services/paint-modal.service';
import { UserStateService } from '../../core/services/user-state.service';
import { HobbyDeskComponent } from './hobby-desk.component';

describe('HobbyDeskComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HobbyDeskComponent],
      providers: [
        provideRouter([]),
        {
          provide: UserStateService,
          useValue: {
            projects: signal([]),
            inventoryModelIds: signal([]),
            wishlistModelIds: signal([]),
            modelInventorySet: signal(new Set<string>()),
            modelWishlistSet: signal(new Set<string>()),
            inventoryPaintIds: signal([]),
            wishlistPaintIds: signal([]),
            allUploadedPhotos: signal([]),
            limits: USER_LIMITS,
          },
        },
        {
          provide: CatalogService,
          useValue: {
            models: signal([]),
            games: signal([]),
            paints: signal([]),
            thirdPartyPaints: signal([]),
            thirdPartyBrands: signal([]),
            compatibilityLinks: signal([]),
            citadelToThirdPartyMap: signal({}),
            classicToToneProMap: signal(new Map()),
          },
        },
        {
          provide: InventoryMatchService,
          useValue: { evaluateStagedReadiness: () => ({}) },
        },
        {
          provide: ImageService,
          useValue: { resolve: () => '' },
        },
        {
          provide: PaintModalService,
          useValue: { openPaint: () => {} },
        },
      ],
    }).compileComponents();
  });

  it('binds tab/sub inputs via linkedSignal and redirects ?tab=settings to /account', () => {
    const router = TestBed.inject(Router);
    const navSpy = spyOn(router, 'navigate').and.resolveTo(true);

    const fixture = TestBed.createComponent(HobbyDeskComponent);
    fixture.componentRef.setInput('tab', 'models');
    fixture.componentRef.setInput('sub', 'wishlist');
    fixture.detectChanges();

    const comp = fixture.componentInstance;
    expect(comp.activeTab()).toBe('models');
    expect(comp.modelSubMode()).toBe('wishlist');

    fixture.componentRef.setInput('tab', 'settings');
    fixture.detectChanges();
    expect(navSpy).toHaveBeenCalledWith(['/account'], { replaceUrl: true });
  });
});
