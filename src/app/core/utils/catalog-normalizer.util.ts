import {
  ColorDetails,
  ColorFinishTier,
  ColorStageStep,
  ColorSummary,
  ModelColorPoint,
  ModelPaintingArea,
  ModelPaintingStep,
  ModelRecipe,
  ModelSummary,
  Paint,
} from '../models/catalog.models';
import { getPaintRepresentativeHex } from './catalog-filter.util';

export type RawColorSummary = ColorSummary & {
  colourGroups?: (string | { name?: string })[];
};

export function normalizePaintingStageLabel(stage: string | undefined): string {
  const normalized = (stage ?? '').trim().toLowerCase();
  if (normalized === 'detail' || normalized === 'battle ready' || normalized === 'detail finish') {
    return 'Detail Finish';
  }
  if (
    normalized === 'artificer' ||
    normalized === 'parade ready' ||
    normalized === 'artificer finish'
  ) {
    return 'Artificer Finish';
  }
  return 'Base Finish';
}

export function extractColorGroupNames(rawGroups: unknown): string[] {
  if (!Array.isArray(rawGroups)) {
    return [];
  }
  return rawGroups
    .map((g) => {
      if (typeof g === 'string') {
        return g;
      }
      if (
        g &&
        typeof g === 'object' &&
        'name' in g &&
        typeof (g as { name?: unknown }).name === 'string'
      ) {
        return (g as { name: string }).name;
      }
      return '';
    })
    .filter(Boolean);
}

export function normalizeColorSummary(c: RawColorSummary): ColorSummary {
  const colorGroups = extractColorGroupNames(c.colorGroups ?? c.colourGroups);
  const basePaintIds = c.basePaintIds ?? c.paintsByStage?.base ?? [];
  const detailPaintIds = c.detailPaintIds ?? c.paintsByStage?.detail ?? [];
  const artificerPaintIds = c.artificerPaintIds ?? c.paintsByStage?.artificer ?? [];
  const requiredPaintIds =
    c.requiredPaintIds ??
    c.allPaintIds ??
    Array.from(new Set([...basePaintIds, ...detailPaintIds, ...artificerPaintIds]));

  return {
    ...c,
    colorGroups,
    basePaintIds,
    detailPaintIds,
    artificerPaintIds,
    requiredPaintIds,
  };
}

export function normalizeModelSummary(m: ModelSummary & { colourIds?: string[] }): ModelSummary {
  const base = m.paintsByStage?.base ?? [];
  const detail = m.paintsByStage?.detail ?? [];
  const artificer = m.paintsByStage?.artificer ?? [];

  return {
    ...m,
    gameIds: m.gameIds ?? [],
    gameNames: m.gameNames ?? [],
    factionIds: m.factionIds ?? [],
    factionNames: m.factionNames ?? [],
    colorIds: m.colorIds ?? m.colourIds ?? [],
    paintsByStage: { base, detail, artificer },
    requiredPaintIds:
      m.requiredPaintIds ?? m.allPaintIds ?? Array.from(new Set([...base, ...detail, ...artificer])),
  };
}

export function enrichStepPaint(
  stepPaint: ModelPaintingStep['paint'] | ColorStageStep['paint'] | undefined,
  paintById: ReadonlyMap<string, Paint>
): ModelPaintingStep['paint'] {
  if (!stepPaint) {
    return undefined;
  }
  const catalogPaint = stepPaint.id ? paintById.get(stepPaint.id) : undefined;
  const potStyle = stepPaint.potStyle ?? catalogPaint?.potStyle;
  const gradientStartHex = stepPaint.gradientStartHex ?? catalogPaint?.gradientStartHex;
  const gradientMiddleHex = stepPaint.gradientMiddleHex ?? catalogPaint?.gradientMiddleHex;
  const gradientEndHex = stepPaint.gradientEndHex ?? catalogPaint?.gradientEndHex;
  return {
    ...stepPaint,
    id: stepPaint.id ?? catalogPaint?.id ?? '',
    name: stepPaint.name ?? catalogPaint?.name ?? '',
    category: stepPaint.category ?? catalogPaint?.category,
    range: stepPaint.range ?? catalogPaint?.range,
    potStyle,
    gradientStartHex,
    gradientMiddleHex,
    gradientEndHex,
    imageUrl: stepPaint.imageUrl ?? catalogPaint?.imageUrl,
    localImagePath: stepPaint.localImagePath ?? catalogPaint?.localImagePath,
  };
}

export function normalizeModelRecipe(
  rawDoc: Record<string, unknown>,
  colorMap: ReadonlyMap<string, ColorSummary>,
  paintMap: ReadonlyMap<string, Paint>,
  summary?: ModelSummary
): ModelRecipe {
  const raw = rawDoc as Partial<ModelRecipe> & {
    colourPoints?: Array<Partial<ModelColorPoint> & { colourId?: string }>;
  };
  const rawPoints = raw.colorPoints ?? raw.colourPoints ?? [];
  const colorPoints: ModelColorPoint[] = rawPoints.map((cp, idx) => {
    const colorId = cp.colorId ?? (cp as { colourId?: string }).colourId ?? '';
    const colSummary = colorId ? colorMap.get(colorId) : undefined;
    const point =
      cp.point && typeof cp.point.x === 'number' && typeof cp.point.y === 'number'
        ? cp.point
        : { x: 0.5, y: 0.5 };
    return {
      id: cp.id ?? (colorId ? `cp_${colorId}` : `cp_${idx}`),
      name: cp.name ?? colSummary?.name ?? '',
      colorId,
      hex: cp.hex ?? colSummary?.hex ?? '#888888',
      point,
      imageUrl: cp.imageUrl ?? colSummary?.imageUrl,
      localImagePath: cp.localImagePath ?? colSummary?.localImagePath,
    };
  });

  const paintingAreas: ModelPaintingArea[] = (raw.paintingAreas ?? []).map((area, areaIdx) => ({
    id: area.id ?? `area_${areaIdx}`,
    areaOrder: area.areaOrder ?? areaIdx + 1,
    name: area.name ?? 'Painting Area',
    subsectionName: area.subsectionName,
    imageUrl: area.imageUrl,
    localImagePath: area.localImagePath,
    paintingSteps: (area.paintingSteps ?? []).map((step, stepIdx): ModelPaintingStep => {
      const stepOrder = step.stepOrder ?? stepIdx + 1;
      return {
        ...step,
        id: step.id ?? `step_${areaIdx}_${stepIdx}`,
        stepOrder,
        stepNumber: step.stepNumber ?? stepOrder,
        paintingStage: normalizePaintingStageLabel(step.paintingStage),
        paint: enrichStepPaint(step.paint, paintMap),
      };
    }),
  }));

  const games = raw.games?.length
    ? raw.games
    : (summary?.gameIds ?? []).map((gid, i) => ({
        id: gid,
        name: summary?.gameNames?.[i] ?? 'Miniature Game',
      }));

  const factions = raw.factions?.length
    ? raw.factions
    : (summary?.factionIds ?? []).map((fid, i) => ({
        gameId: summary?.gameIds?.[0] ?? '',
        gameName: summary?.gameNames?.[0] ?? '',
        factionId: fid,
        factionName: summary?.factionNames?.[i] ?? '',
      }));

  const images = raw.images?.length
    ? raw.images
    : summary?.primaryImage
      ? [summary.primaryImage]
      : [];

  const localImagePaths = raw.localImagePaths?.length
    ? raw.localImagePaths
    : summary?.localPrimaryImage
      ? [summary.localPrimaryImage]
      : [];

  return {
    id: raw.id ?? summary?.id ?? '',
    name: raw.name ?? summary?.name ?? '',
    range: raw.range ?? summary?.range ?? 'warhammer_colour',
    games,
    factions,
    images,
    localImagePaths,
    colorPoints,
    paintingAreas,
    updatedAt: raw.updatedAt ?? summary?.updatedAt,
  };
}

export function inferPaintingStage(
  paintId: string,
  category: string | undefined,
  baseSet: Set<string>,
  detailSet: Set<string>
): string {
  if (baseSet.has(paintId)) {
    return 'Base Finish';
  }
  if (detailSet.has(paintId)) {
    return 'Detail Finish';
  }
  const catLower = (category ?? '').toLowerCase();
  if (catLower === 'base' || catLower === 'spray') {
    return 'Base Finish';
  }
  if (catLower === 'shade' || catLower === 'contrast') {
    return 'Detail Finish';
  }
  return 'Artificer Finish';
}

export function synthesizeModelRecipe(
  summary: ModelSummary,
  colorMap: ReadonlyMap<string, ColorSummary>,
  paintMap: ReadonlyMap<string, Paint>
): ModelRecipe {
  const colorPoints = (summary.colorIds ?? [])
    .map((cid, idx) => {
      const col = colorMap.get(cid);
      if (!col) {
        return null;
      }
      return {
        id: `cp_${cid}`,
        name: col.name,
        colorId: cid,
        hex: col.hex,
        point: {
          x: 0.25 + ((idx * 0.17) % 0.55),
          y: 0.22 + ((idx * 0.21) % 0.58),
        },
      };
    })
    .filter((x): x is NonNullable<typeof x> => Boolean(x));

  const baseSet = new Set(summary.paintsByStage?.base ?? []);
  const detailSet = new Set(summary.paintsByStage?.detail ?? []);

  const steps = (summary.requiredPaintIds ?? [])
    .map((pid, idx) => {
      const p = paintMap.get(pid);
      if (!p) {
        return null;
      }
      return {
        id: `st_${pid}`,
        stepOrder: idx + 1,
        stepNumber: idx + 1,
        paintingStage: inferPaintingStage(pid, p.category, baseSet, detailSet),
        techniqueName: p.category,
        paint: {
          id: p.id,
          name: p.name,
          range: p.range,
          category: p.category,
          potStyle: p.potStyle,
          gradientStartHex: p.gradientStartHex,
          gradientMiddleHex: p.gradientMiddleHex,
          gradientEndHex: p.gradientEndHex,
          imageUrl: p.imageUrl,
          localImagePath: p.localImagePath,
        },
      };
    })
    .filter((x): x is NonNullable<typeof x> => Boolean(x));

  return {
    id: summary.id,
    name: summary.name,
    range: summary.range,
    games: (summary.gameIds ?? []).map((gid, i) => ({
      id: gid,
      name: summary.gameNames?.[i] ?? 'Miniature Game',
    })),
    factions: (summary.factionIds ?? []).map((fid, i) => ({
      gameId: summary.gameIds?.[0] ?? '',
      gameName: summary.gameNames?.[0] ?? '',
      factionId: fid,
      factionName: summary.factionNames?.[i] ?? '',
    })),
    images: summary.primaryImage ? [summary.primaryImage] : [],
    localImagePaths: summary.localPrimaryImage ? [summary.localPrimaryImage] : [],
    colorPoints,
    paintingAreas: [
      {
        id: 'area_required',
        areaOrder: 1,
        name: 'Required Miniature Paints',
        paintingSteps: steps,
      },
    ],
    updatedAt: summary.updatedAt,
  };
}

export function normalizeColorFinishTier(
  tier: ColorFinishTier | null | undefined,
  paintMap: ReadonlyMap<string, Paint>,
  fallbackImage?: string,
  fallbackLocalImage?: string
): ColorFinishTier | undefined {
  if (!tier) {
    return undefined;
  }
  return {
    backpackImage: tier.backpackImage ?? fallbackImage,
    localBackpackImagePath: tier.localBackpackImagePath ?? fallbackLocalImage,
    stages: (tier.stages ?? []).map((step, idx): ColorStageStep => {
      const enriched = enrichStepPaint(step.paint, paintMap);
      return {
        ...step,
        id: step.id ?? `cs_${step.paint?.id ?? idx}_${idx}`,
        stepOrder: step.stepOrder ?? idx + 1,
        paint: enriched
          ? {
              ...enriched,
              hex: step.paint?.hex ?? getPaintRepresentativeHex(enriched),
            }
          : undefined,
      };
    }),
  };
}

export function normalizeColorDetails(
  rawDoc: Record<string, unknown>,
  paintMap: ReadonlyMap<string, Paint>,
  summary?: ColorSummary
): ColorDetails {
  const raw = rawDoc as Partial<ColorDetails> & { colourGroups?: unknown };
  const imageUrl = raw.imageUrl ?? summary?.imageUrl;
  const localImagePath = raw.localImagePath ?? summary?.localImagePath;
  return {
    id: raw.id ?? summary?.id ?? '',
    name: raw.name ?? summary?.name ?? '',
    hex: raw.hex ?? summary?.hex ?? '#888888',
    rgb: raw.rgb,
    range: raw.range ?? summary?.range ?? 'warhammer_colour',
    guideType: raw.guideType ?? summary?.guideType ?? 'miniature',
    colorGroups: extractColorGroupNames(
      raw.colorGroups ?? raw.colourGroups ?? summary?.colorGroups ?? []
    ),
    imageUrl,
    localImagePath,
    headerImage: raw.headerImage ?? summary?.headerImage,
    localHeaderImagePath: raw.localHeaderImagePath ?? summary?.localHeaderImagePath,
    galleryImages: raw.galleryImages,
    localGalleryImagePaths: raw.localGalleryImagePaths,
    baseFinish: normalizeColorFinishTier(raw.baseFinish, paintMap, imageUrl, localImagePath),
    detailFinish: normalizeColorFinishTier(raw.detailFinish, paintMap, imageUrl, localImagePath),
    artificerFinish: normalizeColorFinishTier(
      raw.artificerFinish,
      paintMap,
      imageUrl,
      localImagePath
    ),
    updatedAt: raw.updatedAt ?? summary?.updatedAt,
  };
}

export function paintIdsToColorSteps(
  ids: string[] | undefined,
  paintMap: ReadonlyMap<string, Paint>
): ColorStageStep[] {
  return (ids ?? [])
    .map((pid, idx) => {
      const p = paintMap.get(pid);
      if (!p) {
        return null;
      }
      return {
        id: `cs_${pid}_${idx}`,
        stepOrder: idx + 1,
        technique: p.category,
        paint: {
          id: p.id,
          name: p.name,
          category: p.category,
          range: p.range,
          potStyle: p.potStyle,
          hex: getPaintRepresentativeHex(p),
          gradientStartHex: p.gradientStartHex,
          gradientMiddleHex: p.gradientMiddleHex,
          gradientEndHex: p.gradientEndHex,
          imageUrl: p.imageUrl,
          localImagePath: p.localImagePath,
        },
      };
    })
    .filter((x): x is NonNullable<typeof x> => Boolean(x));
}

export function synthesizeColorDetails(
  summary: ColorSummary,
  paintMap: ReadonlyMap<string, Paint>
): ColorDetails {
  return {
    id: summary.id,
    name: summary.name,
    hex: summary.hex,
    range: summary.range,
    guideType: summary.guideType,
    colorGroups: summary.colorGroups,
    imageUrl: summary.imageUrl,
    localImagePath: summary.localImagePath,
    headerImage: summary.headerImage,
    localHeaderImagePath: summary.localHeaderImagePath,
    baseFinish: {
      backpackImage: summary.imageUrl,
      localBackpackImagePath: summary.localImagePath,
      stages: paintIdsToColorSteps(summary.basePaintIds, paintMap),
    },
    detailFinish: {
      backpackImage: summary.imageUrl,
      localBackpackImagePath: summary.localImagePath,
      stages: paintIdsToColorSteps(summary.detailPaintIds, paintMap),
    },
    artificerFinish: {
      backpackImage: summary.imageUrl,
      localBackpackImagePath: summary.localImagePath,
      stages: paintIdsToColorSteps(summary.artificerPaintIds, paintMap),
    },
    updatedAt: summary.updatedAt,
  };
}
