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

  it('paginates catalogue paints at 60, loads more, resets limit on filter changes, and preserves matching paints live region', async () => {
    const paints = Array.from({ length: 65 }, (_, i) => ({
      id: `p-${i}`,
      name: `Paint ${i}`,
      range: i % 2 === 0 ? ('warhammer_colour' as const) : ('warhammer_pro' as const),
      category: i < 5 ? 'Base' : 'Layer',
      gradientStartHex: '#112233',
      localImagePath: `/paints/p-${i}.png`,
    }));

    await TestBed.configureTestingModule({
      imports: [HobbyDeskPaintsTabComponent],
      providers: [
        {
          provide: CatalogService,
          useValue: {
            paints: signal(paints),
            paintById: signal(new Map(paints.map((p) => [p.id, p]))),
            thirdPartyPaints: signal([]),
            thirdPartyBrands: signal([]),
          },
        },
        {
          provide: UserStateService,
          useValue: {
            state: signal({ inventoryPaintIds: ['p-0'], wishlistPaintIds: [] }),
            inventoryPaintIds: signal(['p-0']),
            wishlistPaintIds: signal([]),
            inventorySet: signal(new Set<string>(['p-0'])),
            wishlistSet: signal(new Set<string>()),
            customPaints: signal([]),
            isOwned: (id: string) => id === 'p-0',
            isWishlisted: () => false,
            toggleInventory: () => {},
            toggleWishlist: () => {},
            addCustomPaint: () => null,
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
    comp.subMode.set('catalogue');
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    expect(comp.visibleLimit()).toBe(60);
    expect(comp.displayedPaints().length).toBe(60);
    expect(root.querySelectorAll('app-paint-action-row').length).toBe(60);
    expect(root.querySelector('[aria-live="polite"]')?.textContent).toContain('Showing 60 of 65 matching paints');

    const loadMoreBtn = root.querySelector('.load-more-row button') as HTMLButtonElement;
    expect(loadMoreBtn.textContent).toContain('5 remaining');
    loadMoreBtn.click();
    fixture.detectChanges();

    expect(comp.visibleLimit()).toBe(120);
    expect(root.querySelectorAll('app-paint-action-row').length).toBe(65);
    expect(root.querySelector('.load-more-row')).toBeNull();

    // Filter resets
    comp.paintSearch.set('Paint');
    fixture.detectChanges();
    expect(comp.visibleLimit()).toBe(60);

    comp.loadMorePaints();
    comp.selectedBrandFilter.set('Citadel Tone Pro');
    fixture.detectChanges();
    expect(comp.visibleLimit()).toBe(60);

    comp.loadMorePaints();
    comp.selectedCategoryFilter.set('Layer');
    fixture.detectChanges();
    expect(comp.visibleLimit()).toBe(60);

    comp.loadMorePaints();
    comp.subMode.set('inventory');
    fixture.detectChanges();
    expect(comp.visibleLimit()).toBe(60);
  });
});
