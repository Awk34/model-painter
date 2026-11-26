export enum CatalogSyncStatus {
  Hydrating = 'hydrating',
  UpToDate = 'up-to-date',
  Updating = 'updating',
  OfflineCached = 'offline-cached',
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
  staticOnly?: boolean;
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
