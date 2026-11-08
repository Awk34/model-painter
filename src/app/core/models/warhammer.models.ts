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
  range: 'warhammer_colour' | 'warhammer_pro' | string;
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
  brand: string;
  range: string;
  code?: string;
  name: string;
  category: string;
  hex: string;
  citadelMatches: ThirdPartyCitadelMatch[];
  isCustom?: boolean;
}

export interface CitadelThirdPartyMatchRef {
  thirdPartyPaintId: string;
  brand: string;
  range: string;
  code?: string;
  name: string;
  category: string;
  hex: string;
  deltaE: number;
  matchQuality: 'exact' | 'close' | 'similar';
}

export interface ColourSummary {
  id: string;
  name: string;
  hex: string;
  range: string;
  guideType: 'miniature' | 'basing' | string;
  colourGroups: string[];
  imageUrl?: string;
  localImagePath?: string;
  headerImage?: string;
  localHeaderImagePath?: string;
  basePaintIds: string[];
  detailPaintIds: string[];
  artificerPaintIds: string[];
  requiredPaintIds: string[];
  updatedAt?: string;
}

export interface ColourStageStep {
  id: string;
  stepOrder: number;
  technique?: string;
  paint?: {
    id: string;
    name: string;
    category?: string;
    range?: string;
    hex?: string;
    gradientStartHex?: string;
    imageUrl?: string;
    localImagePath?: string;
  };
}

export interface ColourFinishTier {
  backpackImage?: string;
  localBackpackImagePath?: string;
  stages: ColourStageStep[];
}

export interface ColourDetails {
  id: string;
  name: string;
  hex: string;
  rgb?: string;
  range: string;
  guideType: 'miniature' | 'basing' | string;
  colourGroups: string[];
  imageUrl?: string;
  localImagePath?: string;
  headerImage?: string;
  localHeaderImagePath?: string;
  galleryImages?: string[];
  localGalleryImagePaths?: string[];
  baseFinish?: ColourFinishTier;
  detailFinish?: ColourFinishTier;
  artificerFinish?: ColourFinishTier;
  updatedAt?: string;
}

export interface ColourGroup {
  id: string;
  name: string;
  hex?: string;
  colourCount?: number;
}

export interface FactionNode {
  id: string;
  name: string;
  iconUrl?: string;
  localIconPath?: string;
  recipeCount: number;
  recipeIds: string[];
  childFactions?: FactionNode[];
}

export interface GameSystem {
  id: string;
  name: string;
  imageUrl?: string;
  localImagePath?: string;
  recipeCount: number;
  recipeIds: string[];
  factions: FactionNode[];
}

export interface ModelSummary {
  id: string;
  name: string;
  range: string;
  primaryImage?: string;
  localPrimaryImage?: string;
  gameIds: string[];
  gameNames: string[];
  factionIds: string[];
  factionNames: string[];
  colourIds: string[];
  requiredPaintIds: string[];
  updatedAt?: string;
}

export interface ModelColourPoint {
  id: string;
  name: string;
  colourId: string;
  hex: string;
  point: {
    x: number;
    y: number;
  };
  imageUrl?: string;
  localImagePath?: string;
}

export interface ModelPaintingStep {
  id: string;
  stepOrder: number;
  stepNumber: number;
  title?: string;
  paintingStage: 'Base Finish' | 'Detail Finish' | 'Artificer Finish' | string;
  qualityTierLabel?: string;
  techniqueName?: string;
  brushName?: string;
  text?: string;
  imageUrl?: string;
  localImagePath?: string;
  paint?: {
    id: string;
    name: string;
    range?: string;
    category?: string;
    gradientStartHex?: string;
    gradientEndHex?: string;
    imageUrl?: string;
    localImagePath?: string;
  };
}

export interface ModelPaintingArea {
  id: string;
  areaOrder: number;
  name: string;
  subsectionName?: string;
  imageUrl?: string;
  localImagePath?: string;
  paintingSteps: ModelPaintingStep[];
}

export interface ModelRecipe {
  id: string;
  name: string;
  range: string;
  games: { id: string; name: string }[];
  factions: {
    gameId: string;
    gameName: string;
    parentFactionId?: string;
    parentFactionName?: string;
    factionId: string;
    factionName: string;
  }[];
  images: string[];
  localImagePaths: string[];
  colourPoints: ModelColourPoint[];
  paintingAreas: ModelPaintingArea[];
  updatedAt?: string;
}

export interface CatalogBundleMeta {
  hash: string;
  updatedAt: string;
  sizeBytes?: number;
  count?: number;
}

export interface CatalogManifest {
  catalogVersion: string;
  updatedAt: string;
  bundles: Record<string, CatalogBundleMeta>;
  counts: {
    paints: number;
    thirdPartyPaints: number;
    colours: number;
    games: number;
    models: number;
  };
}

export interface UserProjectNoteComponent {
  id?: string;
  type: 'text' | 'checkbox';
  value: string;
  checked?: boolean;
}

export interface UserProjectNote {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  components: UserProjectNoteComponent[];
}

export interface UserProject {
  id: string;
  name: string;
  thumbnailUrl?: string;
  localThumbnailPath?: string;
  createdAt: string;
  updatedAt: string;
  recipeIds: string[];
  colourIds: string[];
  notes: UserProjectNote[];
}

export interface UserPreferences {
  defaultRangeFilter: 'all' | 'warhammer_colour' | 'warhammer_pro';
  allowCompatibleSubstitutions: boolean;
  allowThirdPartySubstitutions: boolean;
  preferredThirdPartyBrands: string[];
}

export interface UserAccountState {
  schemaVersion: number;
  updatedAt: string;
  inventoryPaintIds: string[];
  wishlistPaintIds: string[];
  customPaints: ThirdPartyPaint[];
  /** Maps Citadel Paint ID -> Array of user-linked Equivalent Paint IDs */
  customCompatibilityOverrides: Record<string, string[]>;
  projects: UserProject[];
  preferences: UserPreferences;
}

export interface PaintSubstituteMatch {
  requiredPaintId: string;
  substitutePaintId: string;
  substituteName: string;
  substituteBrand: string;
  substituteHex: string;
  matchType: 'tone_pro' | 'classic_citadel' | 'third_party' | 'custom_override';
  deltaE?: number;
}

export interface InventoryReadinessResult {
  totalRequired: number;
  ownedDirectCount: number;
  substitutedCount: number;
  missingCount: number;
  matchPercent: number;
  ownedDirectIds: string[];
  substitutedByPaintId: Record<string, PaintSubstituteMatch>;
  missingPaintIds: string[];
}
