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

export enum CatalogSyncStatus {
  Hydrating = 'hydrating',
  UpToDate = 'up-to-date',
  Updating = 'updating',
  OfflineCached = 'offline-cached',
}

export enum CloudSyncStatus {
  LocalOnly = 'local-only',
  Synced = 'synced',
  Syncing = 'syncing',
  Error = 'error',
}

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

export interface ColorSummary {
  id: string;
  name: string;
  hex: string;
  range: string;
  guideType: 'miniature' | 'basing' | string;
  colorGroups: string[];
  imageUrl?: string;
  localImagePath?: string;
  headerImage?: string;
  localHeaderImagePath?: string;
  basePaintIds: string[];
  detailPaintIds: string[];
  artificerPaintIds: string[];
  requiredPaintIds: string[];
  allPaintIds?: string[];
  paintsByStage?: {
    base?: string[];
    detail?: string[];
    artificer?: string[];
  };
  updatedAt?: string;
}

export interface ColorStageStep {
  id: string;
  stepOrder: number;
  technique?: string;
  paint?: {
    id: string;
    name: string;
    category?: string;
    range?: string;
    potStyle?: string;
    hex?: string;
    gradientStartHex?: string;
    gradientMiddleHex?: string;
    gradientEndHex?: string;
    imageUrl?: string;
    localImagePath?: string;
  };
}

export interface ColorFinishTier {
  backpackImage?: string;
  localBackpackImagePath?: string;
  stages: ColorStageStep[];
}

export interface ColorDetails {
  id: string;
  name: string;
  hex: string;
  rgb?: string;
  range: string;
  guideType: 'miniature' | 'basing' | string;
  colorGroups: string[];
  imageUrl?: string;
  localImagePath?: string;
  headerImage?: string;
  localHeaderImagePath?: string;
  galleryImages?: string[];
  localGalleryImagePaths?: string[];
  baseFinish?: ColorFinishTier;
  detailFinish?: ColorFinishTier;
  artificerFinish?: ColorFinishTier;
  updatedAt?: string;
}

export interface ColorGroup {
  id: string;
  name: string;
  hex?: string;
  colorCount?: number;
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
  colorIds: string[];
  requiredPaintIds: string[];
  allPaintIds?: string[];
  paintsByStage?: {
    base?: string[];
    detail?: string[];
    artificer?: string[];
  };
  updatedAt?: string;
}

export interface ModelColorPoint {
  id: string;
  name: string;
  colorId: string;
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
    potStyle?: string;
    gradientStartHex?: string;
    gradientMiddleHex?: string;
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
  colorPoints: ModelColorPoint[];
  paintingAreas: ModelPaintingArea[];
  updatedAt?: string;
}

export interface CatalogBundleMeta {
  hash: string;
  updatedAt?: string;
  sizeBytes?: number;
  count?: number;
}

export interface CatalogManifest {
  catalogVersion?: string;
  schemaVersion?: number;
  updatedAt: string;
  bundles: Record<string, CatalogBundleMeta | string>;
  counts?: {
    paints: number;
    thirdPartyPaints: number;
    colors: number;
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

export type UserPhotoTargetType = 'model' | 'project' | 'project_model';
export type UserPhotoKind = 'showcase' | 'reference';

export interface UserUploadedPhoto {
  id: string;
  targetType: UserPhotoTargetType;
  targetId: string;
  /** 'showcase' = user's painted model / project photo; 'reference' = private inspiration/reference photo */
  kind: UserPhotoKind;
  /** Always true for 'reference' photos */
  isPrivate: boolean;
  fileName: string;
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
  sizeBytes: number;
  width?: number;
  height?: number;
  caption?: string;
  createdAt: string;
  /** Firebase Cloud Storage object path when uploaded by an authenticated user */
  storagePath?: string;
}

/** Reserved schema for future model loadout / wargear configurations (e.g., Dreadnought weapons) */
export interface ProjectModelConfiguration {
  id: string;
  slot: string;
  option: string;
  optionId?: string;
  notes?: string;
}

export type ProjectModelFeaturedImage =
  | { source: 'uploaded_photo'; photoId: string }
  | { source: 'catalog_angle'; imageIndex: number; localImagePath?: string; imageUrl?: string }
  | { source: 'catalog_model'; modelId: string; localImagePath?: string; imageUrl?: string };

export interface ProjectModelEntry {
  /** Unique instance ID so the same catalog model can be added multiple times to a project */
  id: string;
  /** Catalog ModelSummary / ModelRecipe ID */
  recipeId: string;
  /** Optional custom nickname/label (e.g., "Redemptor — Macro Plasma") */
  customName?: string;
  /** Quantity of this model entry (e.g., 25 for 25x Ork Boy) */
  quantity: number;
  /** Freeform multiline notes scoped to this project model entry */
  notes: string;
  /** Completed painting step / area IDs scoped exclusively to this project model entry */
  completedStepIds: string[];
  /** Custom featured image override; undefined uses the default catalog primary image */
  featuredImage?: ProjectModelFeaturedImage;
  /** Showcase & private reference photo metadata stored inside this project entity */
  photos: UserUploadedPhoto[];
  /** Reserved for future model configurations/loadouts */
  configurations?: ProjectModelConfiguration[];
  createdAt: string;
  updatedAt: string;
}

export interface UserProject {
  id: string;
  name: string;
  thumbnailUrl?: string;
  localThumbnailPath?: string;
  /** Optional ID of a user-uploaded project showcase photo used as cover */
  coverPhotoId?: string;
  createdAt: string;
  updatedAt: string;
  models: ProjectModelEntry[];
  colorIds: string[];
  notes: UserProjectNote[];
  /** Project-level showcase & private reference photo metadata stored inside this project entity */
  photos: UserUploadedPhoto[];
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
  inventoryModelIds: string[];
  wishlistModelIds: string[];
  customPaints: ThirdPartyPaint[];
  /** Maps Citadel Paint ID -> Array of user-linked Equivalent Paint IDs */
  customCompatibilityOverrides: Record<string, string[]>;
  /** Maps Model Recipe ID -> Array of completed painting step / area IDs */
  modelProgress: Record<string, string[]>;
  projects: UserProject[];
  uploadedPhotos: UserUploadedPhoto[];
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

export type FinishStageKey = 'base' | 'detail' | 'artificer';

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

export interface StagedReadinessResult {
  base: InventoryReadinessResult;
  detail: InventoryReadinessResult;
  artificer: InventoryReadinessResult;
  overall: InventoryReadinessResult;
}
