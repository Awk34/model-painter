import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { ColorSummary, ModelSummary, Paint, ThirdPartyPaint } from '../../core/models/catalog.models';
import { CatalogService } from '../../core/services/catalog.service';
import { ImageService } from '../../core/services/image.service';
import { PaintModalService } from '../../core/services/paint-modal.service';
import { UserStateService } from '../../core/services/user-state.service';
import { SearchComponent } from './search.component';

describe('SearchComponent visible* signal caps', () => {
  it('caps visibleCitadelPaints(24), visibleThirdPartyPaints(24), visibleColors(24), and visibleModels(36) while preserving unsliced totals', () => {
    const paints: Paint[] = Array.from({ length: 30 }, (_, i) => ({
      id: `cp-${i}`,
      name: `Alpha Paint ${i}`,
      range: 'warhammer_colour',
      category: 'Base',
      gradientStartHex: '#123456',
    }));
    const thirdPartyPaints: ThirdPartyPaint[] = Array.from({ length: 30 }, (_, i) => ({
      id: `tp-${i}`,
      name: `Alpha Third Party ${i}`,
      brand: 'Vallejo',
      range: 'Model Color',
      category: 'Base',
      hex: '#223344',
      citadelMatches: [],
    }));
    const colors: ColorSummary[] = Array.from({ length: 30 }, (_, i) => ({
      id: `c-${i}`,
      name: `Alpha Color ${i}`,
      hex: '#334455',
      range: 'warhammer_colour',
      guideType: 'miniature',
      colorGroups: ['Blue'],
      requiredPaintIds: [],
      basePaintIds: [],
      detailPaintIds: [],
      artificerPaintIds: [],
    }));
    const models: ModelSummary[] = Array.from({ length: 40 }, (_, i) => ({
      id: `m-${i}`,
      name: `Alpha Model ${i}`,
      range: 'warhammer_colour',
      gameIds: ['w40k'],
      gameNames: ['Warhammer 40,000'],
      factionIds: ['sm'],
      factionNames: ['Space Marines'],
      colorIds: [],
      requiredPaintIds: [],
    }));

    TestBed.configureTestingModule({
      imports: [SearchComponent],
      providers: [
        provideRouter([]),
        {
          provide: CatalogService,
          useValue: {
            paints: signal(paints),
            thirdPartyPaints: signal(thirdPartyPaints),
            colors: signal(colors),
            models: signal(models),
          },
        },
        {
          provide: UserStateService,
          useValue: {
            customPaints: signal([]),
            isOwned: () => false,
            isWishlisted: () => false,
            isModelOwned: () => false,
            isModelWishlisted: () => false,
            toggleInventory: () => {},
            toggleWishlist: () => {},
            toggleModelInventory: () => {},
            toggleModelWishlist: () => {},
          },
        },
        {
          provide: PaintModalService,
          useValue: { openPaint: () => {} },
        },
        {
          provide: ImageService,
          useValue: { resolve: (l?: string | null, r?: string | null) => l || r || '/icons/ic_models.svg' },
        },
      ],
    });

    const fixture = TestBed.createComponent(SearchComponent);
    const comp = fixture.componentInstance;
    comp.query.set('Alpha');
    fixture.detectChanges();

    expect(comp.matchedCitadelPaints().length).toBe(30);
    expect(comp.matchedThirdPartyPaints().length).toBe(30);
    expect(comp.matchedColors().length).toBe(30);
    expect(comp.matchedModels().length).toBe(40);
    expect(comp.totalCount()).toBe(130);

    expect(comp.visibleCitadelPaints().length).toBe(24);
    expect(comp.visibleThirdPartyPaints().length).toBe(24);
    expect(comp.visibleColors().length).toBe(24);
    expect(comp.visibleModels().length).toBe(36);

    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelectorAll('.paints-grid app-paint-action-row').length).toBe(48);
    expect(root.querySelectorAll('.result-card').length).toBe(24);
    expect(root.querySelectorAll('app-model-card').length).toBe(36);
  });
});
