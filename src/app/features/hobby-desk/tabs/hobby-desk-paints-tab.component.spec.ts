import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { CatalogService } from '../../../core/services/catalog.service';
import { ImageService } from '../../../core/services/image.service';
import { PaintModalService } from '../../../core/services/paint-modal.service';
import { UserStateService } from '../../../core/services/user-state.service';
import { HobbyDeskPaintsTabComponent } from './hobby-desk-paints-tab.component';

describe('HobbyDeskPaintsTabComponent custom paint modal draft reset', () => {
  it('resets all customPaintForm fields on closeCustomPaintModal() and after saveCustomPaint()', async () => {
    const addCustomPaintSpy = jasmine.createSpy('addCustomPaint').and.returnValue({
      id: 'custom_1',
      name: 'My Green',
      brand: 'Vallejo',
      range: 'Model Color',
      category: 'Base',
      hex: '#00ff00',
      citadelMatches: [],
      isCustom: true,
    });
    const toggleInventorySpy = jasmine.createSpy('toggleInventory');

    await TestBed.configureTestingModule({
      imports: [HobbyDeskPaintsTabComponent],
      providers: [
        {
          provide: CatalogService,
          useValue: {
            paints: signal([]),
            paintById: signal(new Map()),
            thirdPartyPaints: signal([]),
            thirdPartyBrands: signal([]),
          },
        },
        {
          provide: UserStateService,
          useValue: {
            state: signal({ inventoryPaintIds: [], wishlistPaintIds: [] }),
            inventoryPaintIds: signal([]),
            wishlistPaintIds: signal([]),
            inventorySet: signal(new Set<string>()),
            wishlistSet: signal(new Set<string>()),
            customPaints: signal([]),
            isOwned: () => false,
            isWishlisted: () => false,
            toggleInventory: toggleInventorySpy,
            toggleWishlist: () => {},
            addCustomPaint: addCustomPaintSpy,
          },
        },
        {
          provide: PaintModalService,
          useValue: { openPaint: () => {} },
        },
        {
          provide: ImageService,
          useValue: { resolve: (l?: string | null, r?: string | null) => l || r || '' },
        },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(HobbyDeskPaintsTabComponent);
    const comp = fixture.componentInstance;
    fixture.detectChanges();

    comp.openCustomPaintModal();
    comp.patchCustomPaintForm({
      brand: 'Vallejo',
      range: 'Model Color',
      name: 'Dirty Draft',
      category: 'Metallic',
      hex: '#ff0000',
      citadelPaintId: 'cit-1',
    });
    comp.closeCustomPaintModal();

    expect(comp.showCustomPaintModal()).toBeFalse();
    expect(comp.customPaintForm()).toEqual({
      brand: 'The Army Painter',
      range: 'Warpaints Fanatic',
      name: '',
      category: 'Layer',
      hex: '#3b82f6',
      citadelPaintId: '',
    });

    comp.openCustomPaintModal();
    comp.patchCustomPaintForm({
      brand: 'Vallejo',
      range: 'Model Color',
      name: 'My Green',
      category: 'Base',
      hex: '#00ff00',
    });
    comp.saveCustomPaint();

    expect(addCustomPaintSpy).toHaveBeenCalledTimes(1);
    expect(toggleInventorySpy).toHaveBeenCalledWith('custom_1');
    expect(comp.showCustomPaintModal()).toBeFalse();
    expect(comp.customPaintForm()).toEqual({
      brand: 'The Army Painter',
      range: 'Warpaints Fanatic',
      name: '',
      category: 'Layer',
      hex: '#3b82f6',
      citadelPaintId: '',
    });

    // Verify native <dialog>, <form>, and labeled toolbar controls
    const root = fixture.nativeElement as HTMLElement;
    const searchInput = root.querySelector('#desk-paints-search') as HTMLInputElement;
    expect(searchInput.type).toBe('search');
    expect(searchInput.labels?.length).toBe(1);
    expect(root.querySelector('[aria-live="polite"]')?.textContent).toContain('matching paints');

    comp.openCustomPaintModal();
    fixture.detectChanges();
    const dialog = root.querySelector('dialog') as HTMLDialogElement;
    expect(dialog.open).toBeTrue();
    expect(dialog.getAttribute('aria-labelledby')).toBeTruthy();
    expect(dialog.querySelector('form button[type="submit"]')).not.toBeNull();
  });
});
