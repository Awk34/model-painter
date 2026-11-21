import {
  CitadelPaintRange,
  InventoryReadinessResult,
  KNOWN_THIRD_PARTY_BRANDS,
  PaintBrand,
} from '../models/catalog.models';
import {
  applyReadinessFilter,
  createEntityId,
  getCitadelBrandLabel,
  getPaintRepresentativeHex,
  getPaintSwatchBackground,
  isKnownPaintBrand,
  isMetallicPaint,
  isShadePaint,
  matchesModelSearch,
  mergeCatalogBrands,
  normalizePaintBrand,
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

  describe('brand enum & dynamic catalog brand helpers', () => {
    it('identifies hard-coded PaintBrand values case-insensitively via isKnownPaintBrand', () => {
      expect(isKnownPaintBrand(PaintBrand.CitadelColour)).toBeTrue();
      expect(isKnownPaintBrand('the army painter')).toBeTrue();
      expect(isKnownPaintBrand('Scale75')).toBeFalse();
      expect(isKnownPaintBrand(null)).toBeFalse();
    });

    it('merges hard-coded brands with Firestore catalog brands without duplicates', () => {
      const merged = mergeCatalogBrands(
        ['vallejo', 'Scale75', 'Citadel Colour'],
        [
          { brand: 'Kimera Kolors' },
          { brand: 'AK Interactive' },
          { brand: 'scale75' },
        ]
      );

      expect(merged).toEqual([
        ...KNOWN_THIRD_PARTY_BRANDS,
        'Scale75',
        'Kimera Kolors',
      ]);
    });

    it('normalizes Citadel, known 3rd-party, and dynamic catalog brands', () => {
      expect(normalizePaintBrand(undefined, CitadelPaintRange.WarhammerColour)).toEqual({
        brand: PaintBrand.CitadelColour,
        isKnownBrand: true,
        isCitadel: true,
        isTonePro: false,
        variant: 'gold',
      });

      expect(normalizePaintBrand(undefined, CitadelPaintRange.WarhammerPro)).toEqual({
        brand: PaintBrand.CitadelTonePro,
        isKnownBrand: true,
        isCitadel: true,
        isTonePro: true,
        variant: 'pro',
      });

      expect(normalizePaintBrand('vallejo', 'Game Color')).toEqual({
        brand: PaintBrand.Vallejo,
        isKnownBrand: true,
        isCitadel: false,
        isTonePro: false,
        variant: 'sub',
      });

      expect(
        normalizePaintBrand('scale75', 'Scalecolor', [...KNOWN_THIRD_PARTY_BRANDS, 'Scale75'])
      ).toEqual({
        brand: 'Scale75',
        isKnownBrand: false,
        isCitadel: false,
        isTonePro: false,
        variant: 'sub',
      });
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

  describe('paint color & metallic swatch helpers', () => {
    const retributorArmour = {
      potStyle: 'metallic',
      category: 'base',
      gradientStartHex: '#FFFFFF',
      gradientMiddleHex: '#EBB854',
      gradientEndHex: '#89571D',
    };

    const leadbelcher = {
      potStyle: 'metallic',
      category: 'base',
      gradientStartHex: '#F0F0F0',
      gradientMiddleHex: '#8A8A8A',
      gradientEndHex: '#151E24',
    };

    const canoptekAlloy = {
      potStyle: 'metallic',
      category: 'layer',
      gradientStartHex: '#F5EDE3',
      gradientMiddleHex: '#FBF8F8',
      gradientEndHex: '#B09791',
    };

    const thirdPartyMetallic = {
      potStyle: 'metallic',
      category: 'base',
      hex: '#C4902C',
    };

    const customMetallicByCategory = {
      category: 'Metallic',
      hex: '#6D7378',
    };

    const nulnOil = {
      potStyle: 'shade',
      category: 'shade',
      gradientStartHex: '#DFD9D6',
      gradientMiddleHex: '#5D5A58',
      gradientEndHex: '#101010',
    };

    const reiklandFleshshade = {
      potStyle: 'shade',
      category: 'shade',
      gradientStartHex: '#FFD5B7',
      gradientMiddleHex: '#AC491D',
      gradientEndHex: '#311908',
    };

    const thirdPartyShade = {
      potStyle: 'shade',
      category: 'shade',
      hex: '#423122',
    };

    const baalRed = {
      potStyle: 'contrast',
      category: 'contrast',
      gradientStartHex: '#C01823',
      gradientEndHex: '#D51C29',
    };

    const abaddonBlack = {
      potStyle: 'flat',
      category: 'base',
      gradientStartHex: '#000000',
    };

    const mephistonRed = {
      potStyle: 'flat',
      category: 'base',
      gradientStartHex: '#960C09',
    };

    it('detects metallic paints by potStyle or category', () => {
      expect(isMetallicPaint(retributorArmour)).toBeTrue();
      expect(isMetallicPaint(thirdPartyMetallic)).toBeTrue();
      expect(isMetallicPaint(customMetallicByCategory)).toBeTrue();
      expect(isMetallicPaint(nulnOil)).toBeFalse();
      expect(isMetallicPaint(abaddonBlack)).toBeFalse();
      expect(isMetallicPaint(null)).toBeFalse();
    });

    it('detects shade paints by potStyle or category', () => {
      expect(isShadePaint(nulnOil)).toBeTrue();
      expect(isShadePaint(thirdPartyShade)).toBeTrue();
      expect(isShadePaint({ category: 'Shade' })).toBeTrue();
      expect(isShadePaint(retributorArmour)).toBeFalse();
      expect(isShadePaint(abaddonBlack)).toBeFalse();
      expect(isShadePaint(null)).toBeFalse();
    });

    it('returns representative body hexes rather than white highlights for metallics and shades', () => {
      expect(getPaintRepresentativeHex(retributorArmour)).toBe('#EBB854');
      expect(getPaintRepresentativeHex(leadbelcher)).toBe('#8A8A8A');
      expect(getPaintRepresentativeHex(canoptekAlloy)).toBe('#B09791');
      expect(getPaintRepresentativeHex(thirdPartyMetallic)).toBe('#C4902C');
      expect(getPaintRepresentativeHex(nulnOil)).toBe('#5D5A58');
      expect(getPaintRepresentativeHex(reiklandFleshshade)).toBe('#AC491D');
      expect(getPaintRepresentativeHex(thirdPartyShade)).toBe('#423122');
      expect(getPaintRepresentativeHex(baalRed)).toBe('#C01823');
      expect(getPaintRepresentativeHex(abaddonBlack)).toBe('#000000');
      expect(getPaintRepresentativeHex(mephistonRed)).toBe('#960C09');
    });

    it('builds metallic sheen gradients for Citadel and 3rd-party metallic paints', () => {
      expect(getPaintSwatchBackground(retributorArmour)).toBe(
        'linear-gradient(135deg, #EBB854 0%, #FFFFFF 26%, #EBB854 50%, #89571D 86%, #EBB854 100%)'
      );
      expect(getPaintSwatchBackground(leadbelcher)).toBe(
        'linear-gradient(135deg, #8A8A8A 0%, #F0F0F0 26%, #8A8A8A 50%, #151E24 86%, #8A8A8A 100%)'
      );
      expect(getPaintSwatchBackground(canoptekAlloy)).toContain('#B09791 0%, #FBF8F8 26%, #B09791 50%');

      const tpBg = getPaintSwatchBackground(thirdPartyMetallic);
      expect(tpBg).toContain('linear-gradient(135deg, #C4902C 0%');
      expect(tpBg).toContain('#C4902C 50%');
      expect(tpBg).not.toBe('#C4902C');

      const customBg = getPaintSwatchBackground(customMetallicByCategory);
      expect(customBg).toContain('linear-gradient(135deg, #6D7378 0%');
    });

    it('builds strong pooling gradients for shade paints, gradients for contrast, and solid hexes for flat paints', () => {
      expect(getPaintSwatchBackground(nulnOil)).toBe(
        'linear-gradient(145deg, #DFD9D6 12%, #5D5A58 40%, #101010 68%, #0B0A09 90%)'
      );
      expect(getPaintSwatchBackground(reiklandFleshshade)).toBe(
        'linear-gradient(145deg, #FFD5B7 12%, #AC491D 40%, #311908 68%, #1C0E05 90%)'
      );
      const tpShadeBg = getPaintSwatchBackground(thirdPartyShade);
      expect(tpShadeBg).toContain('linear-gradient(145deg,');
      expect(tpShadeBg).toContain('#423122 40%');
      expect(getPaintSwatchBackground(baalRed)).toBe(
        'linear-gradient(135deg, #C01823 0%, #D51C29 100%)'
      );
      expect(getPaintSwatchBackground(abaddonBlack)).toBe('#000000');
      expect(getPaintSwatchBackground(mephistonRed)).toBe('#960C09');
    });
  });
});

