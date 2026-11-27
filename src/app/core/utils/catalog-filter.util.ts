import {
  CitadelPaintRange,
  InventoryReadinessResult,
  KNOWN_THIRD_PARTY_BRANDS,
  ModelSummary,
  PaintBrand,
} from '../models/catalog.models';

export type ReadinessFilterMode = 'all' | 'ready100' | 'missing1' | 'missing2' | 'sortReady';

/**
 * Checks whether a miniature summary matches a lowercased search query
 * across model name, faction names, and game system names.
 */
export function matchesModelSearch(
  model: Pick<ModelSummary, 'name' | 'factionNames' | 'gameNames'>,
  queryLower: string
): boolean {
  if (!queryLower) {
    return true;
  }
  if (model.name.toLowerCase().includes(queryLower)) {
    return true;
  }
  if (model.factionNames.some((fn) => fn.toLowerCase().includes(queryLower))) {
    return true;
  }
  return model.gameNames.some((gn) => gn.toLowerCase().includes(queryLower));
}

/**
 * Filters or sorts items decorated with an InventoryReadinessResult by readiness mode.
 */
export function applyReadinessFilter<T extends { readiness: InventoryReadinessResult }>(
  items: T[],
  filter: ReadinessFilterMode
): T[] {
  if (filter === 'ready100') {
    return items.filter((x) => x.readiness.totalRequired > 0 && x.readiness.matchPercent === 100);
  }
  if (filter === 'missing1') {
    return items.filter((x) => x.readiness.totalRequired > 0 && x.readiness.missingCount <= 1);
  }
  if (filter === 'missing2') {
    return items.filter((x) => x.readiness.totalRequired > 0 && x.readiness.missingCount <= 2);
  }
  if (filter === 'sortReady') {
    return items.toSorted((a, b) => b.readiness.matchPercent - a.readiness.matchPercent);
  }
  return items;
}

/**
 * Formats a Citadel paint range identifier into its user-facing display label.
 */
export function getCitadelBrandLabel(
  range?: CitadelPaintRange | string | null,
  classicLabel: PaintBrand | string = PaintBrand.CitadelClassic
): string {
  if (range === CitadelPaintRange.WarhammerPro || range === PaintBrand.CitadelTonePro) {
    return PaintBrand.CitadelTonePro;
  }
  return classicLabel;
}

export type PaintBrandBadgeVariant = 'gold' | 'pro' | 'sub';

export interface PaintBrandLike {
  brand?: PaintBrand | string | null;
  range?: CitadelPaintRange | string | null;
}

export interface NormalizedPaintBrand {
  brand: PaintBrand | string;
  isKnownBrand: boolean;
  isCitadel: boolean;
  isTonePro: boolean;
  variant: PaintBrandBadgeVariant;
}

const PAINT_BRAND_BY_LOWER = new Map<string, PaintBrand>(
  (Object.values(PaintBrand) as PaintBrand[]).map((b) => [b.toLowerCase(), b])
);

export function isKnownPaintBrand(brand: string | null | undefined): brand is PaintBrand {
  if (!brand) {
    return false;
  }
  return PAINT_BRAND_BY_LOWER.has(brand.trim().toLowerCase());
}

/**
 * Merges the hard-coded `KNOWN_THIRD_PARTY_BRANDS` enum list with dynamic brands
 * pulled from the Firestore catalog (`brands` array and `thirdPartyPaints` items).
 * Deduplicates case-insensitively so newly added catalog brands appear immediately
 * and do not duplicate once promoted into `PaintBrand`.
 */
export function mergeCatalogBrands(
  catalogBrands?: readonly string[] | null,
  paints?: readonly { brand?: string | null }[] | null,
  baseBrands: readonly string[] = KNOWN_THIRD_PARTY_BRANDS
): string[] {
  const seenLower = new Set<string>();
  const result: string[] = [];

  const addBrand = (raw: string | null | undefined) => {
    const trimmed = (raw ?? '').trim();
    if (!trimmed) {
      return;
    }
    const lower = trimmed.toLowerCase();
    if (
      lower === PaintBrand.CitadelColour.toLowerCase() ||
      lower === PaintBrand.CitadelClassic.toLowerCase() ||
      lower === PaintBrand.CitadelTonePro.toLowerCase()
    ) {
      return;
    }
    if (seenLower.has(lower)) {
      return;
    }
    seenLower.add(lower);
    const enumMatch = PAINT_BRAND_BY_LOWER.get(lower);
    result.push(enumMatch ?? trimmed);
  };

  for (const b of baseBrands) {
    addBrand(b);
  }
  for (const b of catalogBrands ?? []) {
    addBrand(b);
  }
  for (const p of paints ?? []) {
    addBrand(p?.brand);
  }

  return result;
}

/**
 * Resolves a paint/color/model brand and range against the hard-coded `PaintBrand` enum
 * and dynamic Firestore catalog brands.
 */
export function normalizePaintBrand(
  brand?: PaintBrand | string | null,
  range?: CitadelPaintRange | string | null,
  catalogBrands: readonly string[] = KNOWN_THIRD_PARTY_BRANDS,
  classicLabel: PaintBrand | string = PaintBrand.CitadelColour
): NormalizedPaintBrand {
  const trimmedBrand = (brand ?? '').trim();
  const trimmedRange = (range ?? '').trim();

  if (trimmedBrand) {
    const lower = trimmedBrand.toLowerCase();
    const enumMatch = PAINT_BRAND_BY_LOWER.get(lower);

    if (
      enumMatch === PaintBrand.CitadelTonePro ||
      trimmedRange === CitadelPaintRange.WarhammerPro
    ) {
      return {
        brand: PaintBrand.CitadelTonePro,
        isKnownBrand: true,
        isCitadel: true,
        isTonePro: true,
        variant: 'pro',
      };
    }

    if (enumMatch === PaintBrand.CitadelColour || enumMatch === PaintBrand.CitadelClassic) {
      return {
        brand: classicLabel,
        isKnownBrand: true,
        isCitadel: true,
        isTonePro: false,
        variant: 'gold',
      };
    }

    if (enumMatch) {
      return {
        brand: enumMatch,
        isKnownBrand: true,
        isCitadel: false,
        isTonePro: false,
        variant: 'sub',
      };
    }

    const catalogMatch = catalogBrands.find((b) => b.trim().toLowerCase() === lower);
    return {
      brand: catalogMatch ? catalogMatch.trim() : trimmedBrand,
      isKnownBrand: false,
      isCitadel: false,
      isTonePro: false,
      variant: 'sub',
    };
  }

  if (trimmedRange === CitadelPaintRange.WarhammerPro) {
    return {
      brand: PaintBrand.CitadelTonePro,
      isKnownBrand: true,
      isCitadel: true,
      isTonePro: true,
      variant: 'pro',
    };
  }

  return {
    brand: classicLabel,
    isKnownBrand: true,
    isCitadel: true,
    isTonePro: false,
    variant: 'gold',
  };
}

/**
 * Generates a collision-resistant local entity ID using Web Crypto.
 */
export function createEntityId(prefix: string): string {
  const randomSuffix = crypto.randomUUID().replace(/-/g, '').slice(0, 8);
  return `${prefix}_${Date.now()}_${randomSuffix}`;
}

export interface PaintSwatchLike {
  potStyle?: string | null;
  category?: string | null;
  hex?: string | null;
  gradientStartHex?: string | null;
  gradientMiddleHex?: string | null;
  gradientEndHex?: string | null;
}

const EMPTY_FALLBACK_SWATCH: PaintSwatchLike = Object.freeze({});
const FALLBACK_SWATCH_CACHE = new Map<string, PaintSwatchLike>();

/**
 * Returns a referentially stable PaintSwatchLike fallback object for a given category
 * so OnPush child components do not receive newly allocated object literals per CD pass.
 */
export function getFallbackSwatch(category?: string | null): PaintSwatchLike {
  const key = category?.trim();
  if (!key) {
    return EMPTY_FALLBACK_SWATCH;
  }
  let cached = FALLBACK_SWATCH_CACHE.get(key);
  if (!cached) {
    cached = Object.freeze({ category: key });
    FALLBACK_SWATCH_CACHE.set(key, cached);
  }
  return cached;
}

function parseHexRgb(hex: string | null | undefined): [number, number, number] | null {
  if (!hex) {
    return null;
  }
  const clean = hex.trim().replace(/^#/, '');
  if (/^[0-9a-fA-F]{3}$/.test(clean)) {
    return [
      parseInt(clean[0] + clean[0], 16),
      parseInt(clean[1] + clean[1], 16),
      parseInt(clean[2] + clean[2], 16),
    ];
  }
  if (/^[0-9a-fA-F]{6}$/.test(clean)) {
    return [
      parseInt(clean.slice(0, 2), 16),
      parseInt(clean.slice(2, 4), 16),
      parseInt(clean.slice(4, 6), 16),
    ];
  }
  return null;
}

function formatHexRgb(r: number, g: number, b: number): string {
  const clampByte = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  const toHex = (v: number) => clampByte(v).toString(16).padStart(2, '0').toUpperCase();
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function getHexLuminance(hex: string | null | undefined): number {
  const rgb = parseHexRgb(hex);
  if (!rgb) {
    return -1;
  }
  return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
}

function mixHex(hexA: string, hexB: string, weightB: number): string {
  const rgbA = parseHexRgb(hexA);
  const rgbB = parseHexRgb(hexB);
  if (!rgbA || !rgbB) {
    return hexA;
  }
  const t = Math.max(0, Math.min(1, weightB));
  return formatHexRgb(
    rgbA[0] * (1 - t) + rgbB[0] * t,
    rgbA[1] * (1 - t) + rgbB[1] * t,
    rgbA[2] * (1 - t) + rgbB[2] * t
  );
}

/**
 * Returns true when a paint uses a metallic finish.
 */
export function isMetallicPaint(paint: PaintSwatchLike | null | undefined): boolean {
  if (!paint) {
    return false;
  }
  return (
    paint.potStyle?.toLowerCase() === 'metallic' ||
    paint.category?.toLowerCase() === 'metallic'
  );
}

/**
 * Returns true when a paint is a shade or wash.
 */
export function isShadePaint(paint: PaintSwatchLike | null | undefined): boolean {
  if (!paint) {
    return false;
  }
  return (
    paint.potStyle?.toLowerCase() === 'shade' ||
    paint.category?.toLowerCase() === 'shade'
  );
}

/**
 * Returns the single best representative hex color for a paint.
 * For Citadel metallic and shade paints, `gradientStartHex` stores the specular highlight
 * or pale edge while `gradientMiddleHex` holds the true body tone.
 */
export function getPaintRepresentativeHex(
  paint: PaintSwatchLike | null | undefined,
  fallback = '#888888'
): string {
  if (!paint) {
    return fallback;
  }
  const start = paint.gradientStartHex || undefined;
  const mid = paint.gradientMiddleHex || undefined;
  const end = paint.gradientEndHex || undefined;

  if (isMetallicPaint(paint)) {
    if (mid) {
      if (start && getHexLuminance(mid) > getHexLuminance(start)) {
        return end || start || fallback;
      }
      return mid;
    }
    return paint.hex || end || start || fallback;
  }

  if (isShadePaint(paint)) {
    return mid || paint.hex || end || start || fallback;
  }

  return start || paint.hex || fallback;
}

/**
 * Builds a CSS `background` value for paint swatches.
 * Metallic paints render a multi-stop diagonal specular sheen using their true midtone and shadow;
 * shade, contrast, gloss, and texture paints render their multi-stop gradients.
 */
export function getPaintSwatchBackground(
  paint: PaintSwatchLike | null | undefined,
  fallback = '#888888'
): string {
  if (!paint) {
    return fallback;
  }
  const start = paint.gradientStartHex || undefined;
  const mid = paint.gradientMiddleHex || undefined;
  const end = paint.gradientEndHex || undefined;

  if (isMetallicPaint(paint)) {
    let highlight: string;
    let body: string;
    let shadow: string;

    if (start && mid && end) {
      if (getHexLuminance(mid) > getHexLuminance(start)) {
        highlight = mid;
        body = end;
        shadow = mixHex(end, '#000000', 0.35);
      } else {
        highlight = start;
        body = mid;
        shadow = end;
      }
    } else {
      body = getPaintRepresentativeHex(paint, fallback);
      highlight = start && start !== body ? start : mixHex(body, '#FFFFFF', 0.62);
      shadow = end && end !== body ? end : mixHex(body, '#000000', 0.45);
    }

    return `linear-gradient(135deg, ${body} 0%, ${highlight} 26%, ${body} 50%, ${shadow} 86%, ${body} 100%)`;
  }

  if (isShadePaint(paint)) {
    let tint: string;
    let midTone: string;
    let recess: string;

    if (start && mid && end) {
      tint = start;
      midTone = mid;
      recess = end;
    } else {
      const base = getPaintRepresentativeHex(paint, fallback);
      tint = start && start !== base ? start : mixHex(base, '#EDE6DC', 0.72);
      midTone = mid && mid !== base ? mid : base;
      recess = end && end !== base ? end : mixHex(base, '#080504', 0.48);
    }
    const deepPool = mixHex(recess, '#050302', 0.48);

    return `linear-gradient(145deg, ${tint} 12%, ${midTone} 40%, ${recess} 68%, ${deepPool} 90%)`;
  }

  if (start && mid && end) {
    return `linear-gradient(135deg, ${start} 0%, ${mid} 48%, ${end} 100%)`;
  }
  if (start && end) {
    return `linear-gradient(135deg, ${start} 0%, ${end} 100%)`;
  }

  return start || paint.hex || fallback;
}
