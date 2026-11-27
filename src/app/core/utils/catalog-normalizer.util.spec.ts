import { ColorSummary, ModelSummary, Paint } from '../models/catalog.models';
import {
  computeMatchQuality,
  enrichStepPaint,
  extractColorGroupNames,
  inferPaintingStage,
  normalizeColorDetails,
  normalizeColorSummary,
  normalizeModelRecipe,
  normalizeModelSummary,
  normalizePaintingStageLabel,
  normalizeThirdPartyBundle,
  synthesizeColorDetails,
  synthesizeModelRecipe,
} from './catalog-normalizer.util';

describe('catalog-normalizer.util', () => {
  const paintMap = new Map<string, Paint>([
    [
      'p-base',
      {
        id: 'p-base',
        name: 'Mephiston Red',
        range: 'warhammer_colour',
        category: 'Base',
        gradientStartHex: '#9A1115',
      },
    ],
    [
      'p-shade',
      {
        id: 'p-shade',
        name: 'Nuln Oil',
        range: 'warhammer_colour',
        category: 'Shade',
        potStyle: 'shade',
        gradientStartHex: '#CCCCCC',
        gradientMiddleHex: '#181818',
        gradientEndHex: '#050505',
      },
    ],
    [
      'p-layer',
      {
        id: 'p-layer',
        name: 'Evil Sunz Scarlet',
        range: 'warhammer_colour',
        category: 'Layer',
        gradientStartHex: '#C21F1F',
      },
    ],
  ]);

  const colorMap = new Map<string, ColorSummary>([
    [
      'c-red',
      {
        id: 'c-red',
        name: 'Blood Red',
        hex: '#9A1115',
        range: 'warhammer_colour',
        guideType: 'miniature',
        colorGroups: ['Reds'],
        basePaintIds: ['p-base'],
        detailPaintIds: ['p-shade'],
        artificerPaintIds: ['p-layer'],
        requiredPaintIds: ['p-base', 'p-shade', 'p-layer'],
      },
    ],
  ]);

  it('normalizes stage labels and color group names', () => {
    expect(normalizePaintingStageLabel('detail')).toBe('Detail Finish');
    expect(normalizePaintingStageLabel('parade ready')).toBe('Artificer Finish');
    expect(normalizePaintingStageLabel(undefined)).toBe('Base Finish');
    expect(extractColorGroupNames(['Reds', { name: 'Metallics' }, null, { name: '' }])).toEqual([
      'Reds',
      'Metallics',
    ]);
  });

  it('normalizes legacy colourGroups/paintsByStage fields on ColorSummary and ModelSummary', () => {
    const color = normalizeColorSummary({
      id: 'c1',
      name: 'Gold',
      hex: '#D4AF37',
      range: 'warhammer_colour',
      guideType: 'miniature',
      colorGroups: undefined as never,
      colourGroups: [{ name: 'Metallics' }],
      basePaintIds: undefined as never,
      detailPaintIds: undefined as never,
      artificerPaintIds: undefined as never,
      requiredPaintIds: undefined as never,
      paintsByStage: { base: ['p-base'], detail: ['p-shade'] },
    });
    expect(color.colorGroups).toEqual(['Metallics']);
    expect(color.requiredPaintIds).toEqual(['p-base', 'p-shade']);

    const model = normalizeModelSummary({
      id: 'm1',
      name: 'Marine',
      range: 'warhammer_colour',
      gameIds: undefined as never,
      gameNames: undefined as never,
      factionIds: undefined as never,
      factionNames: undefined as never,
      colorIds: undefined as never,
      colourIds: ['c-red'],
      requiredPaintIds: undefined as never,
      paintsByStage: { base: ['p-base'], artificer: ['p-layer'] },
    });
    expect(model.colorIds).toEqual(['c-red']);
    expect(model.requiredPaintIds).toEqual(['p-base', 'p-layer']);
  });

  it('normalizes and synthesizes ModelRecipe and ColorDetails with paint enrichment', () => {
    const summary: ModelSummary = {
      id: 'm-1',
      name: 'Intercessor',
      range: 'warhammer_colour',
      primaryImage: 'https://example.com/m1.jpg',
      gameIds: ['w40k'],
      gameNames: ['Warhammer 40,000'],
      factionIds: ['sm'],
      factionNames: ['Space Marines'],
      colorIds: ['c-red'],
      requiredPaintIds: ['p-base', 'p-shade', 'p-layer'],
      paintsByStage: { base: ['p-base'], detail: ['p-shade'], artificer: ['p-layer'] },
    };

    const normalized = normalizeModelRecipe(
      {
        id: 'm-1',
        colourPoints: [{ colourId: 'c-red' }],
        paintingAreas: [
          {
            name: 'Armour',
            paintingSteps: [{ paintingStage: 'detail', paint: { id: 'p-shade' } }],
          },
        ],
      },
      colorMap,
      paintMap,
      summary
    );
    expect(normalized.colorPoints[0].name).toBe('Blood Red');
    expect(normalized.paintingAreas[0].paintingSteps[0].paintingStage).toBe('Detail Finish');
    expect(normalized.paintingAreas[0].paintingSteps[0].paint?.potStyle).toBe('shade');

    const synth = synthesizeModelRecipe(summary, colorMap, paintMap);
    expect(synth.colorPoints.length).toBe(1);
    expect(synth.paintingAreas[0].paintingSteps.map((s) => s.paintingStage)).toEqual([
      'Base Finish',
      'Detail Finish',
      'Artificer Finish',
    ]);

    const colDetails = normalizeColorDetails(
      {
        id: 'c-red',
        baseFinish: { stages: [{ paint: { id: 'p-shade' } }] },
      },
      paintMap,
      colorMap.get('c-red')
    );
    expect(colDetails.baseFinish?.stages[0].paint?.hex).toBe('#181818');

    const synthColor = synthesizeColorDetails(colorMap.get('c-red')!, paintMap);
    expect(synthColor.baseFinish?.stages[0].paint?.id).toBe('p-base');
    expect(synthColor.detailFinish?.stages[0].paint?.id).toBe('p-shade');
    expect(synthColor.artificerFinish?.stages[0].paint?.id).toBe('p-layer');
  });

  it('handles undefined stepPaint, invalid colorPoint coordinates, and inferPaintingStage category heuristics', () => {
    expect(enrichStepPaint(undefined, paintMap)).toBeUndefined();

    const recipeWithBadPoint = normalizeModelRecipe(
      {
        id: 'm-bad-pt',
        colourPoints: [
          { colourId: 'c-red', point: { x: 'bad', y: 0.2 } },
          { colourId: 'c-red', point: null },
        ],
        paintingAreas: [],
      },
      colorMap,
      paintMap
    );
    expect(recipeWithBadPoint.colorPoints[0].point).toEqual({ x: 0.5, y: 0.5 });
    expect(recipeWithBadPoint.colorPoints[1].point).toEqual({ x: 0.5, y: 0.5 });

    const baseSet = new Set<string>();
    const detailSet = new Set<string>();
    expect(inferPaintingStage('p-spray', 'Spray', baseSet, detailSet)).toBe('Base Finish');
    expect(inferPaintingStage('p-contrast', 'Contrast', baseSet, detailSet)).toBe('Detail Finish');
    expect(inferPaintingStage('p-layer', 'Layer', baseSet, detailSet)).toBe('Artificer Finish');
  });

  it('normalizes legacy third-party bundles missing matchQuality, category, and potStyle', () => {
    expect(computeMatchQuality(2.5)).toBe('exact');
    expect(computeMatchQuality(8.0)).toBe('close');
    expect(computeMatchQuality(18.5)).toBe('similar');

    const normalized = normalizeThirdPartyBundle({
      thirdPartyPaints: [
        {
          id: 'tp-val-72011',
          brand: 'Vallejo',
          range: 'Game Color',
          code: '72.011',
          name: 'Gory Red',
          category: 'base',
          potStyle: 'flat',
          hex: '#8D1C21',
          citadelMatches: [
            {
              citadelPaintId: 'p-base',
              citadelPaintName: 'Mephiston Red',
              citadelRange: 'warhammer_colour',
              citadelCategory: 'base',
              citadelHex: '#9A1115',
              deltaE: 3.1,
              matchType: 'curated',
            },
          ],
        },
      ],
      citadelToThirdParty: {
        'p-base': [
          {
            thirdPartyPaintId: 'tp-val-72011',
            brand: 'Vallejo',
            range: 'Game Color',
            name: 'Gory Red',
            hex: '#8D1C21',
            deltaE: 9.4,
            matchType: 'color_match',
          },
        ],
      },
    });

    expect(normalized.thirdPartyPaints[0].citadelMatches[0].matchQuality).toBe('exact');
    expect('matchType' in normalized.thirdPartyPaints[0].citadelMatches[0]).toBeFalse();

    const ref = normalized.citadelToThirdPartyMap['p-base'][0];
    expect(ref.matchQuality).toBe('close');
    expect(ref.category).toBe('base');
    expect(ref.potStyle).toBe('flat');
    expect(ref.code).toBe('72.011');
    expect('matchType' in ref).toBeFalse();
  });
});
