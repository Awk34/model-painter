import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Paint } from '../../../core/models/catalog.models';
import { CatalogService } from '../../../core/services/catalog.service';
import { PaintModalService } from '../../../core/services/paint-modal.service';
import { UserStateService } from '../../../core/services/user-state.service';
import { getFallbackSwatch } from '../../../core/utils/catalog-filter.util';
import { HobbyDeskConverterTabComponent } from './hobby-desk-converter-tab.component';

describe('HobbyDeskConverterTabComponent', () => {
  it('caps visibleCrossBrandRows at 120 while keeping full filteredCrossBrandRows and reuses memoized fallback swatches', () => {
    const paints: Paint[] = Array.from({ length: 130 }, (_, i) => ({
      id: `cit-${i}`,
      name: `Citadel Paint ${i}`,
      range: 'warhammer_colour',
      category: 'Base',
      gradientStartHex: '#112233',
    }));

    const citadelToThirdPartyMap: Record<
      string,
      Array<{
        thirdPartyPaintId: string;
        brand: string;
        range: string;
        name: string;
        category: string;
        hex: string;
        deltaE: number;
        matchQuality: 'exact' | 'close' | 'similar';
      }>
    > = {};
    for (const cp of paints) {
      citadelToThirdPartyMap[cp.id] = [
        {
          thirdPartyPaintId: `tp-${cp.id}`,
          brand: 'Vallejo',
          range: 'Model Color',
          name: `TP ${cp.id}`,
          category: 'Layer',
          hex: '#223344',
          deltaE: 1.2,
          matchQuality: 'exact',
        },
      ];
    }

    TestBed.configureTestingModule({
      imports: [HobbyDeskConverterTabComponent],
      providers: [
        {
          provide: CatalogService,
          useValue: {
            paints: signal(paints),
            paintById: signal(new Map(paints.map((p) => [p.id, p]))),
            thirdPartyPaintById: signal(new Map()),
            thirdPartyBrands: signal(['Vallejo']),
            compatibilityLinks: signal([]),
            citadelToThirdPartyMap: signal(citadelToThirdPartyMap),
            classicToToneProMap: signal(new Map()),
          },
        },
        {
          provide: UserStateService,
          useValue: {
            inventorySet: signal(new Set<string>()),
            wishlistSet: signal(new Set<string>()),
            isOwned: () => false,
            isWishlisted: () => false,
            toggleInventory: () => {},
            toggleWishlist: () => {},
          },
        },
        {
          provide: PaintModalService,
          useValue: { openPaint: () => {} },
        },
      ],
    });

    const fixture = TestBed.createComponent(HobbyDeskConverterTabComponent);
    const comp = fixture.componentInstance;
    fixture.detectChanges();

    expect(comp.filteredCrossBrandRows().length).toBe(130);
    expect(comp.visibleCrossBrandRows().length).toBe(120);
    expect((fixture.nativeElement as HTMLElement).querySelectorAll('.converter-row').length).toBe(120);

    const swatchA = comp.visibleCrossBrandRows()[0].matches[0].swatch;
    const swatchB = comp.visibleCrossBrandRows()[1].matches[0].swatch;
    expect(swatchA).toBe(getFallbackSwatch('Layer'));
    expect(swatchA).toBe(swatchB);
  });
});
