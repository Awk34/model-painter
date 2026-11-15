import { InventoryReadinessResult } from '../models/catalog.models';
import {
  applyReadinessFilter,
  createEntityId,
  getCitadelBrandLabel,
  matchesModelSearch,
} from './catalog-filter.util';

function makeReadiness(overrides: Partial<InventoryReadinessResult>): InventoryReadinessResult {
  return {
    totalRequired: 4,
    ownedDirectCount: 2,
    substitutedCount: 0,
    missingCount: 2,
    matchPercent: 50,
    ownedDirectIds: [],
    substitutedByPaintId: {},
    missingPaintIds: [],
    ...overrides,
  };
}

describe('catalog-filter.util', () => {
  describe('matchesModelSearch', () => {
    const sampleModel = {
      name: 'Space Marine Terminator Captain',
      factionNames: ['Ultramarines', 'Space Marines'],
      gameNames: ['Warhammer 40,000'],
    };

    it('matches empty query unconditionally', () => {
      expect(matchesModelSearch(sampleModel, '')).toBeTrue();
    });

    it('matches model name, faction name, and game name case-insensitively', () => {
      expect(matchesModelSearch(sampleModel, 'terminator')).toBeTrue();
      expect(matchesModelSearch(sampleModel, 'ultramarines')).toBeTrue();
      expect(matchesModelSearch(sampleModel, '40,000')).toBeTrue();
      expect(matchesModelSearch(sampleModel, 'skaven')).toBeFalse();
    });
  });

  describe('applyReadinessFilter', () => {
    const items = [
      { id: 'empty', readiness: makeReadiness({ totalRequired: 0, missingCount: 0, matchPercent: 100 }) },
      { id: 'full', readiness: makeReadiness({ totalRequired: 4, missingCount: 0, matchPercent: 100 }) },
      { id: 'miss1', readiness: makeReadiness({ totalRequired: 4, missingCount: 1, matchPercent: 75 }) },
      { id: 'miss2', readiness: makeReadiness({ totalRequired: 4, missingCount: 2, matchPercent: 50 }) },
      { id: 'miss3', readiness: makeReadiness({ totalRequired: 4, missingCount: 3, matchPercent: 25 }) },
    ];

    it('returns original items when mode is all', () => {
      expect(applyReadinessFilter(items, 'all').map((x) => x.id)).toEqual([
        'empty',
        'full',
        'miss1',
        'miss2',
        'miss3',
      ]);
    });

    it('filters to non-empty 100% ready items for ready100', () => {
      expect(applyReadinessFilter(items, 'ready100').map((x) => x.id)).toEqual(['full']);
    });

    it('filters to non-empty items missing at most 1 paint for missing1', () => {
      expect(applyReadinessFilter(items, 'missing1').map((x) => x.id)).toEqual(['full', 'miss1']);
    });

    it('filters to non-empty items missing at most 2 paints for missing2', () => {
      expect(applyReadinessFilter(items, 'missing2').map((x) => x.id)).toEqual([
        'full',
        'miss1',
        'miss2',
      ]);
    });

    it('sorts descending by matchPercent without mutating input for sortReady', () => {
      const copy = [...items].reverse();
      const sorted = applyReadinessFilter(copy, 'sortReady');
      expect(sorted.map((x) => x.readiness.matchPercent)).toEqual([100, 100, 75, 50, 25]);
      expect(copy[0].id).toBe('miss3');
    });
  });

  describe('getCitadelBrandLabel', () => {
    it('maps warhammer_pro to Citadel Tone Pro and defaults to Citadel Classic', () => {
      expect(getCitadelBrandLabel('warhammer_pro')).toBe('Citadel Tone Pro');
      expect(getCitadelBrandLabel('warhammer_colour')).toBe('Citadel Classic');
      expect(getCitadelBrandLabel(undefined, 'Citadel Colour')).toBe('Citadel Colour');
    });
  });

  describe('createEntityId', () => {
    it('generates prefixed collision-resistant IDs', () => {
      const idA = createEntityId('proj');
      const idB = createEntityId('proj');
      expect(idA).toMatch(/^proj_\d+_[0-9a-f]{8}$/);
      expect(idA).not.toBe(idB);
    });
  });
});

