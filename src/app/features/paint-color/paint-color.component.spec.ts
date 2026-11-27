import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { ColorSummary, InventoryReadinessResult, StagedReadinessResult } from '../../core/models/catalog.models';
import { CatalogService } from '../../core/services/catalog.service';
import { ImageService } from '../../core/services/image.service';
import { InventoryMatchService } from '../../core/services/inventory-match.service';
import { UserStateService } from '../../core/services/user-state.service';
import { PaintColorComponent } from './paint-color.component';

function makeReadiness(): InventoryReadinessResult {
  return {
    totalRequired: 1,
    ownedDirectCount: 0,
    substitutedCount: 0,
    missingCount: 1,
    matchPercent: 0,
    ownedDirectIds: [],
    substitutedByPaintId: {},
    missingPaintIds: ['p1'],
  };
}

const SAMPLE_STAGED: StagedReadinessResult = {
  base: makeReadiness(),
  detail: makeReadiness(),
  artificer: makeReadiness(),
  overall: makeReadiness(),
};

describe('PaintColorComponent', () => {
  const colors: ColorSummary[] = Array.from({ length: 65 }, (_, i) => ({
    id: `c-${i}`,
    name: `Color Guide ${i}`,
    hex: '#123456',
    range: i % 2 === 0 ? 'warhammer_colour' : 'warhammer_pro',
    guideType: i === 0 ? 'basing' : 'miniature',
    colorGroups: [i < 5 ? 'Red' : 'Blue'],
    requiredPaintIds: ['p1'],
    basePaintIds: ['p1'],
    detailPaintIds: [],
    artificerPaintIds: [],
    localImagePath: `/colors/c-${i}.png`,
  }));

  let prefsSignal: ReturnType<
    typeof signal<{
      defaultRangeFilter: 'all' | 'warhammer_colour' | 'warhammer_pro';
      allowCompatibleSubstitutions: boolean;
      allowThirdPartySubstitutions: boolean;
      preferredThirdPartyBrands: string[];
    }>
  >;

  beforeEach(() => {
    prefsSignal = signal({
      defaultRangeFilter: 'all',
      allowCompatibleSubstitutions: true,
      allowThirdPartySubstitutions: true,
      preferredThirdPartyBrands: [],
    });

    TestBed.configureTestingModule({
      imports: [PaintColorComponent],
      providers: [
        provideRouter([]),
        {
          provide: CatalogService,
          useValue: {
            colors: signal(colors),
            colorGroups: signal([
              { id: 'red', name: 'Red', hex: '#cc0000' },
              { id: 'blue', name: 'Blue', hex: '#0044cc' },
            ]),
          },
        },
        {
          provide: InventoryMatchService,
          useValue: {
            evaluateStagedReadiness: () => SAMPLE_STAGED,
          },
        },
        {
          provide: UserStateService,
          useValue: {
            preferences: prefsSignal,
          },
        },
        {
          provide: ImageService,
          useValue: {
            resolve: (local?: string | null, remote?: string | null) =>
              local || remote || '/icons/ic_color.svg',
          },
        },
      ],
    });
  });

  it('paginates at 60 cards, loads more, resets on filter changes and resetFilters(), and sets card img attributes', () => {
    const fixture = TestBed.createComponent(PaintColorComponent);
    const comp = fixture.componentInstance;
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    expect(comp.visibleLimit()).toBe(60);
    expect(comp.displayedColors().length).toBe(60);
    expect(root.querySelectorAll('.color-card').length).toBe(60);
    expect(root.querySelector('.results-meta')?.textContent).toContain('Showing 60 of 65 matching color guides');

    const firstImg = root.querySelector('.color-preview-box img') as HTMLImageElement;
    expect(firstImg.getAttribute('loading')).toBe('lazy');
    expect(firstImg.getAttribute('decoding')).toBe('async');
    expect(firstImg.getAttribute('width')).toBe('155');
    expect(firstImg.getAttribute('height')).toBe('155');

    const loadMoreBtn = root.querySelector('.load-more-row button') as HTMLButtonElement;
    expect(loadMoreBtn.textContent).toContain('5 remaining');
    loadMoreBtn.click();
    fixture.detectChanges();

    expect(comp.visibleLimit()).toBe(120);
    expect(root.querySelectorAll('.color-card').length).toBe(65);
    expect(root.querySelector('.load-more-row')).toBeNull();

    // Changing filters resets visibleLimit back to 60
    comp.selectedGroup.set('Blue');
    fixture.detectChanges();
    expect(comp.visibleLimit()).toBe(60);

    comp.loadMore();
    expect(comp.visibleLimit()).toBe(120);
    comp.onlyBasing.set(true);
    fixture.detectChanges();
    expect(comp.visibleLimit()).toBe(60);

    comp.loadMore();
    comp.searchQuery.set('Color');
    fixture.detectChanges();
    expect(comp.visibleLimit()).toBe(60);

    comp.loadMore();
    comp.rangeFilter.set('warhammer_pro');
    fixture.detectChanges();
    expect(comp.visibleLimit()).toBe(60);

    comp.loadMore();
    comp.targetStage.set('detail');
    fixture.detectChanges();
    expect(comp.visibleLimit()).toBe(60);

    comp.loadMore();
    comp.readinessFilter.set('sortReady');
    fixture.detectChanges();
    expect(comp.visibleLimit()).toBe(60);

    comp.loadMore();
    comp.resetFilters();
    fixture.detectChanges();
    expect(comp.visibleLimit()).toBe(60);
    expect(comp.selectedGroup()).toBeNull();
    expect(comp.onlyBasing()).toBeFalse();
    expect(comp.searchQuery()).toBe('');
  });

  it('initializes rangeFilter from userState.preferences().defaultRangeFilter', () => {
    prefsSignal.set({
      defaultRangeFilter: 'warhammer_pro',
      allowCompatibleSubstitutions: true,
      allowThirdPartySubstitutions: true,
      preferredThirdPartyBrands: [],
    });

    const fixture = TestBed.createComponent(PaintColorComponent);
    const comp = fixture.componentInstance;
    fixture.detectChanges();

    expect(comp.rangeFilter()).toBe('warhammer_pro');
    expect(comp.filteredColors().every((item) => item.color.range === 'warhammer_pro')).toBeTrue();
  });
});
