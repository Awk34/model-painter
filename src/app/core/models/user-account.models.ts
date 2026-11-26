import { ThirdPartyPaint } from './paint.models';

export type CollectionSubMode = 'inventory' | 'wishlist' | 'catalogue';

export enum CloudSyncStatus {
  LocalOnly = 'local-only',
  Synced = 'synced',
  Syncing = 'syncing',
  Error = 'error',
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
