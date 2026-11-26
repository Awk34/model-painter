export enum CitadelPaintRange {
  WarhammerColour = 'warhammer_colour',
  WarhammerPro = 'warhammer_pro',
}

export enum PaintBrand {
  CitadelColour = 'Citadel Colour',
  CitadelClassic = 'Citadel Classic',
  CitadelTonePro = 'Citadel Tone Pro',
  TheArmyPainter = 'The Army Painter',
  Vallejo = 'Vallejo',
  TwoThinCoats = 'Two Thin Coats',
  MonumentHobbies = 'Monument Hobbies',
  ProAcryl = 'Pro Acryl',
  AkInteractive = 'AK Interactive',
}

export const KNOWN_THIRD_PARTY_BRANDS: readonly PaintBrand[] = [
  PaintBrand.TheArmyPainter,
  PaintBrand.Vallejo,
  PaintBrand.TwoThinCoats,
  PaintBrand.MonumentHobbies,
  PaintBrand.AkInteractive,
] as const;

export interface ToneProPentadPaint {
  id: string;
  name: string;
  hex: string;
  position?: number;
}

export interface CompatibleToneProRef {
  id: string;
  name: string;
  hex: string;
}

export interface Paint {
  id: string;
  name: string;
  range: CitadelPaintRange | 'warhammer_colour' | 'warhammer_pro' | string;
  category: string;
  potStyle?: string;
  gradientStartHex: string;
  gradientMiddleHex?: string;
  gradientEndHex?: string;
  rgb?: string;
  imageUrl?: string;
  localImagePath?: string;
  warhammerProRange?: ToneProPentadPaint[];
  compatibleToneProPaints?: CompatibleToneProRef[];
}

export interface PaintCompatibilityLink {
  classic_paint_id: string;
  classic_paint_name: string;
  classic_category: string;
  tone_pro_paint_id: string;
  tone_pro_paint_name: string;
  tone_pro_hex: string;
}

export interface ThirdPartyCitadelMatch {
  citadelPaintId: string;
  citadelPaintName: string;
  citadelRange: string;
  citadelCategory: string;
  citadelHex: string;
  deltaE: number;
  matchQuality: 'exact' | 'close' | 'similar';
}

export interface ThirdPartyPaint {
  id: string;
  brand: PaintBrand | string;
  range: string;
  code?: string;
  name: string;
  category: string;
  potStyle?: string;
  hex: string;
  citadelMatches: ThirdPartyCitadelMatch[];
  isCustom?: boolean;
}

export interface CitadelThirdPartyMatchRef {
  thirdPartyPaintId: string;
  brand: PaintBrand | string;
  range: string;
  code?: string;
  name: string;
  category: string;
  potStyle?: string;
  hex: string;
  deltaE: number;
  matchQuality: 'exact' | 'close' | 'similar';
}
