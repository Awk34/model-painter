import { USER_LIMITS } from '../config/user-limits.config';
import {
  ProjectModelConfiguration,
  ProjectModelEntry,
  ProjectModelFeaturedImage,
  UserAccountState,
  UserPhotoKind,
  UserPhotoTargetType,
  UserProject,
  UserProjectNote,
  UserProjectNoteComponent,
  UserUploadedPhoto,
} from '../models/catalog.models';
import { createEntityId } from './catalog-filter.util';

export const CURRENT_SCHEMA_VERSION = 2;

export function createDefaultState(): UserAccountState {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    updatedAt: new Date().toISOString(),
    inventoryPaintIds: [],
    wishlistPaintIds: [],
    inventoryModelIds: [],
    wishlistModelIds: [],
    customPaints: [],
    customCompatibilityOverrides: {},
    modelProgress: {},
    projects: [],
    uploadedPhotos: [],
    preferences: {
      defaultRangeFilter: 'all',
      allowCompatibleSubstitutions: true,
      allowThirdPartySubstitutions: true,
      preferredThirdPartyBrands: [
        'The Army Painter',
        'Vallejo',
        'Two Thin Coats',
        'Monument Hobbies',
        'AK Interactive',
      ],
    },
  };
}

export function stripUndefinedDeep<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => stripUndefinedDeep(item)) as unknown as T;
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v !== undefined) {
        out[k] = stripUndefinedDeep(v);
      }
    }
    return out as T;
  }
  return value;
}

export function dedupeBoundedIds(raw: unknown, max: number): string[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return Array.from(new Set(raw.map((id) => String(id)).filter(Boolean))).slice(0, max);
}

export function clampModelQuantity(raw: unknown): number {
  const parsed = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(parsed)) {
    return 1;
  }
  return Math.min(USER_LIMITS.MAX_MODEL_QUANTITY, Math.max(1, Math.trunc(parsed)));
}

function optionalTrimmedString(raw: unknown, maxLen: number): string | undefined {
  if (typeof raw !== 'string') {
    return undefined;
  }
  const trimmed = raw.trim();
  return trimmed ? trimmed.slice(0, maxLen) : undefined;
}

function extractIdArray(primaryIds: unknown, legacyObjects?: unknown): string[] {
  if (Array.isArray(primaryIds)) {
    return primaryIds.map((id) => String(id)).filter(Boolean);
  }
  if (Array.isArray(legacyObjects)) {
    return (legacyObjects as Record<string, unknown>[])
      .map((item) => String(item['id'] ?? ''))
      .filter(Boolean);
  }
  return [];
}

function normalizePhotoEntry(
  raw: unknown,
  forcedTarget?: { targetType: UserPhotoTargetType; targetId: string }
): UserUploadedPhoto | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const ph = raw as Partial<UserUploadedPhoto>;
  if (!ph.id) {
    return null;
  }
  const kind: UserPhotoKind = ph.kind === 'reference' ? 'reference' : 'showcase';
  const targetType: UserPhotoTargetType =
    forcedTarget?.targetType ??
    (ph.targetType === 'project' || ph.targetType === 'project_model' ? ph.targetType : 'model');
  const targetId = forcedTarget?.targetId ?? String(ph.targetId ?? '');
  if (!targetId) {
    return null;
  }

  return {
    id: String(ph.id).slice(0, 120),
    targetType,
    targetId: targetId.slice(0, 200),
    kind,
    isPrivate: kind === 'reference' ? true : Boolean(ph.isPrivate ?? true),
    fileName: String(ph.fileName || 'photo.jpg').slice(0, 255),
    mimeType:
      ph.mimeType === 'image/png' || ph.mimeType === 'image/webp' ? ph.mimeType : 'image/jpeg',
    sizeBytes:
      typeof ph.sizeBytes === 'number' && ph.sizeBytes > 0
        ? Math.max(1, Math.min(Math.trunc(ph.sizeBytes), USER_LIMITS.MAX_PHOTO_FILE_SIZE_BYTES))
        : 1,
    width: typeof ph.width === 'number' && ph.width > 0 ? Math.trunc(ph.width) : undefined,
    height: typeof ph.height === 'number' && ph.height > 0 ? Math.trunc(ph.height) : undefined,
    caption: ph.caption ? String(ph.caption).slice(0, USER_LIMITS.MAX_PHOTO_CAPTION_LENGTH) : undefined,
    createdAt: String(ph.createdAt || new Date().toISOString()).slice(0, 64),
    storagePath: ph.storagePath ? String(ph.storagePath).slice(0, 512) : undefined,
  };
}

function normalizeBoundedPhotos(
  rawItems: unknown[],
  forcedTarget: { targetType: UserPhotoTargetType; targetId: string },
  max: number
): UserUploadedPhoto[] {
  const photoMap = new Map<string, UserUploadedPhoto>();
  for (const item of rawItems) {
    if (photoMap.size >= max) {
      break;
    }
    const ph = normalizePhotoEntry(item, forcedTarget);
    if (ph && !photoMap.has(ph.id)) {
      photoMap.set(ph.id, ph);
    }
  }
  return Array.from(photoMap.values());
}

function normalizeFeaturedImage(raw: unknown): ProjectModelFeaturedImage | undefined {
  if (!raw || typeof raw !== 'object') {
    return undefined;
  }
  const fi = raw as Record<string, unknown>;
  if (fi['source'] === 'uploaded_photo') {
    const photoId = optionalTrimmedString(fi['photoId'], 120);
    return photoId ? { source: 'uploaded_photo', photoId } : undefined;
  }
  if (fi['source'] === 'catalog_angle') {
    const idx = Math.trunc(Number(fi['imageIndex']));
    if (!Number.isFinite(idx) || idx < 0 || idx > 50) {
      return undefined;
    }
    return {
      source: 'catalog_angle',
      imageIndex: idx,
      localImagePath: optionalTrimmedString(fi['localImagePath'], 512),
      imageUrl: optionalTrimmedString(fi['imageUrl'], 2048),
    };
  }
  if (fi['source'] === 'catalog_model') {
    const modelId = optionalTrimmedString(fi['modelId'], 200);
    if (!modelId) {
      return undefined;
    }
    return {
      source: 'catalog_model',
      modelId,
      localImagePath: optionalTrimmedString(fi['localImagePath'], 512),
      imageUrl: optionalTrimmedString(fi['imageUrl'], 2048),
    };
  }
  return undefined;
}

export function normalizeConfigurations(raw: unknown): ProjectModelConfiguration[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) {
    return undefined;
  }
  const normalized: ProjectModelConfiguration[] = [];
  for (let i = 0; i < raw.length && normalized.length < USER_LIMITS.MAX_CONFIGURATIONS_PER_MODEL; i++) {
    const item = raw[i];
    if (!item || typeof item !== 'object') {
      continue;
    }
    const rec = item as Record<string, unknown>;
    const slot = optionalTrimmedString(rec['slot'], 120);
    const option = optionalTrimmedString(rec['option'], 200);
    if (!slot || !option) {
      continue;
    }
    normalized.push({
      id: String(rec['id'] ?? `cfg_${i}`).slice(0, 120),
      slot,
      option,
      optionId: rec['optionId'] ? String(rec['optionId']).slice(0, 200) : undefined,
      notes: rec['notes'] ? String(rec['notes']).slice(0, 500) : undefined,
    });
  }
  return normalized.length > 0 ? normalized : undefined;
}

function normalizeIncomingNote(
  rn: Record<string, unknown>,
  projectId: string,
  idx: number,
  defaultTimestamp: string
): UserProjectNote {
  const rawComps = Array.isArray(rn['components'])
    ? (rn['components'] as Record<string, unknown>[])
    : [];
  const components: UserProjectNoteComponent[] = rawComps
    .slice(0, USER_LIMITS.MAX_NOTE_BLOCKS_PER_NOTE)
    .map((rc) => ({
      type: rc['type'] === 'checkbox' ? 'checkbox' : 'text',
      value: String(rc['value'] ?? rc['text'] ?? '').slice(0, USER_LIMITS.MAX_NOTE_TEXT_LENGTH),
      checked: Boolean(rc['checked'] ?? false),
    }));

  return {
    id: String(rn['id'] ?? `note_${projectId}_${idx}`),
    title: String(rn['title'] ?? rn['name'] ?? 'Project Note').slice(
      0,
      USER_LIMITS.MAX_TITLE_LENGTH
    ),
    createdAt: String(rn['createdAt'] ?? defaultTimestamp),
    updatedAt: String(rn['updatedAt'] ?? defaultTimestamp),
    components,
  };
}

function normalizeProjectModelEntry(
  raw: Record<string, unknown>,
  projectId: string,
  idx: number,
  defaultTimestamp: string
): ProjectModelEntry | null {
  const recipeId = optionalTrimmedString(raw['recipeId'], 200);
  if (!recipeId) {
    return null;
  }
  const id = String(raw['id'] ?? `pmod_${projectId}_${idx}`).trim().slice(0, 120);
  const createdAt = String(raw['createdAt'] ?? defaultTimestamp).slice(0, 64);
  const updatedAt = String(raw['updatedAt'] ?? createdAt).slice(0, 64);
  const rawPhotos = Array.isArray(raw['photos']) ? raw['photos'] : [];
  const photos = normalizeBoundedPhotos(
    rawPhotos,
    { targetType: 'project_model', targetId: id },
    USER_LIMITS.MAX_PHOTOS_PER_PROJECT_MODEL
  );

  let featuredImage = normalizeFeaturedImage(raw['featuredImage']);
  if (featuredImage?.source === 'uploaded_photo') {
    const targetPhotoId = featuredImage.photoId;
    if (!photos.some((ph) => ph.id === targetPhotoId)) {
      featuredImage = undefined;
    }
  }

  return {
    id,
    recipeId,
    customName: optionalTrimmedString(raw['customName'], USER_LIMITS.MAX_TITLE_LENGTH),
    quantity: clampModelQuantity(raw['quantity']),
    notes: String(raw['notes'] ?? '').slice(0, USER_LIMITS.MAX_MODEL_NOTE_LENGTH),
    completedStepIds: dedupeBoundedIds(
      raw['completedStepIds'],
      USER_LIMITS.MAX_STEPS_PER_MODEL_PROGRESS
    ),
    featuredImage,
    photos,
    configurations: normalizeConfigurations(raw['configurations']),
    createdAt,
    updatedAt,
  };
}

function normalizeProjectModels(
  rp: Record<string, unknown>,
  projectId: string,
  createdAt: string,
  updatedAt: string
): ProjectModelEntry[] {
  if (!Array.isArray(rp['models'])) {
    // Support My Warhammer API import format (`recipes: [{ id }]`)
    const importedRecipeIds = dedupeBoundedIds(
      extractIdArray(undefined, rp['recipes']),
      USER_LIMITS.MAX_MODELS_PER_PROJECT
    );
    return importedRecipeIds.map((recipeId, idx) => ({
      id: createEntityId(`pmod_${idx}`),
      recipeId,
      quantity: 1,
      notes: '',
      completedStepIds: [],
      photos: [],
      createdAt,
      updatedAt,
    }));
  }

  const models: ProjectModelEntry[] = [];
  const seenIds = new Set<string>();
  for (let i = 0; i < rp['models'].length && models.length < USER_LIMITS.MAX_MODELS_PER_PROJECT; i++) {
    const rawEntry = rp['models'][i];
    if (!rawEntry || typeof rawEntry !== 'object') {
      continue;
    }
    const entry = normalizeProjectModelEntry(
      rawEntry as Record<string, unknown>,
      projectId,
      i,
      updatedAt
    );
    if (!entry) {
      continue;
    }
    if (seenIds.has(entry.id)) {
      entry.id = createEntityId('pmod');
    }
    seenIds.add(entry.id);
    models.push(entry);
  }
  return models;
}

export function normalizeIncomingProject(rp: Record<string, unknown>): UserProject {
  const id = String(rp['id'] ?? createEntityId('proj')).slice(0, 120);
  const name = String(rp['name'] ?? 'Imported Project').slice(0, USER_LIMITS.MAX_TITLE_LENGTH);
  const createdAt = String(rp['createdAt'] ?? new Date().toISOString()).slice(0, 64);
  const updatedAt = String(rp['updatedAt'] ?? createdAt).slice(0, 64);

  const models = normalizeProjectModels(rp, id, createdAt, updatedAt);

  const colorIds = Array.isArray(rp['colorIds'])
    ? (rp['colorIds'] as string[])
    : Array.isArray(rp['colourIds'])
    ? (rp['colourIds'] as string[])
    : extractIdArray(undefined, rp['colors'] ?? rp['colours']);

  const rawNotes = Array.isArray(rp['notes']) ? (rp['notes'] as Record<string, unknown>[]) : [];
  const notes = rawNotes
    .slice(0, USER_LIMITS.MAX_NOTES_PER_PROJECT)
    .map((rn, idx) => normalizeIncomingNote(rn, id, idx, updatedAt));

  const rawEmbeddedPhotos = Array.isArray(rp['photos']) ? rp['photos'] : [];
  const photos = normalizeBoundedPhotos(
    rawEmbeddedPhotos,
    { targetType: 'project', targetId: id },
    USER_LIMITS.MAX_PROJECT_PHOTOS_PER_PROJECT
  );

  const firstRecipe = Array.isArray(rp['recipes'])
    ? (rp['recipes'][0] as Record<string, unknown> | undefined)
    : undefined;
  const firstRecipeImg = Array.isArray(firstRecipe?.['images'])
    ? (firstRecipe['images'][0] as string | undefined)
    : undefined;
  const firstRecipeLocalImg = Array.isArray(firstRecipe?.['localImagePaths'])
    ? (firstRecipe['localImagePaths'][0] as string | undefined)
    : undefined;

  const thumbUrl = rp['thumbnailUrl'] ?? rp['imageUrl'] ?? firstRecipeImg;
  const localThumb = rp['localThumbnailPath'] ?? rp['localImagePath'] ?? firstRecipeLocalImg;
  let coverPhotoId = rp['coverPhotoId'] ? String(rp['coverPhotoId']).slice(0, 120) : undefined;
  if (coverPhotoId && !photos.some((ph) => ph.id === coverPhotoId)) {
    coverPhotoId = undefined;
  }

  return {
    id,
    name,
    thumbnailUrl: thumbUrl ? String(thumbUrl).slice(0, 2048) : undefined,
    localThumbnailPath: localThumb ? String(localThumb).slice(0, 512) : undefined,
    coverPhotoId,
    createdAt,
    updatedAt,
    models,
    colorIds: dedupeBoundedIds(colorIds, USER_LIMITS.MAX_COLORS_PER_PROJECT),
    notes,
    photos,
  };
}

function normalizeModelProgress(raw: unknown): Record<string, string[]> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {};
  }
  const out: Record<string, string[]> = {};
  for (const [modelId, stepIds] of Object.entries(raw as Record<string, unknown>)) {
    if (!modelId) {
      continue;
    }
    const normalized = dedupeBoundedIds(stepIds, USER_LIMITS.MAX_STEPS_PER_MODEL_PROGRESS);
    if (normalized.length > 0) {
      out[modelId] = normalized;
    }
    if (Object.keys(out).length >= USER_LIMITS.MAX_MODEL_PROGRESS_KEYS) {
      break;
    }
  }
  return out;
}

export function normalizeAccountState(raw: Partial<UserAccountState>): UserAccountState {
  const def = createDefaultState();
  const rawProjects = Array.isArray(raw.projects)
    ? (raw.projects as unknown as Record<string, unknown>[])
    : [];
  const rawPhotos = Array.isArray(raw.uploadedPhotos) ? raw.uploadedPhotos : [];
  const standalonePhotos = rawPhotos
    .map((item) => normalizePhotoEntry(item))
    .filter((ph): ph is UserUploadedPhoto => Boolean(ph && ph.targetType === 'model'))
    .slice(0, USER_LIMITS.MAX_TOTAL_USER_PHOTOS);

  const projects = rawProjects
    .slice(0, USER_LIMITS.MAX_PROJECTS)
    .map((p) => normalizeIncomingProject(p));

  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    updatedAt: raw.updatedAt ?? def.updatedAt,
    inventoryPaintIds: dedupeBoundedIds(raw.inventoryPaintIds, USER_LIMITS.MAX_INVENTORY_PAINTS),
    wishlistPaintIds: dedupeBoundedIds(raw.wishlistPaintIds, USER_LIMITS.MAX_WISHLIST_PAINTS),
    inventoryModelIds: dedupeBoundedIds(raw.inventoryModelIds, USER_LIMITS.MAX_INVENTORY_MODELS),
    wishlistModelIds: dedupeBoundedIds(raw.wishlistModelIds, USER_LIMITS.MAX_WISHLIST_MODELS),
    customPaints: Array.isArray(raw.customPaints)
      ? raw.customPaints.slice(0, USER_LIMITS.MAX_CUSTOM_PAINTS)
      : [],
    customCompatibilityOverrides:
      raw.customCompatibilityOverrides && typeof raw.customCompatibilityOverrides === 'object'
        ? raw.customCompatibilityOverrides
        : {},
    modelProgress: normalizeModelProgress(raw.modelProgress),
    projects,
    uploadedPhotos: standalonePhotos.slice(0, USER_LIMITS.MAX_TOTAL_USER_PHOTOS),
    preferences: {
      ...def.preferences,
      ...(raw.preferences ?? {}),
    },
  };
}

export function collectProjectPhotos(
  project: Pick<UserProject, 'photos' | 'models'>
): UserUploadedPhoto[] {
  const out: UserUploadedPhoto[] = [...project.photos];
  for (const model of project.models) {
    out.push(...model.photos);
  }
  return out;
}

export function cloneCatalogFeaturedImage(
  featuredImage?: ProjectModelFeaturedImage
): ProjectModelFeaturedImage | undefined {
  if (!featuredImage || featuredImage.source === 'uploaded_photo') {
    return undefined;
  }
  return structuredClone(featuredImage);
}

export function extractAccountDocPayload(
  state: UserAccountState
): Omit<UserAccountState, 'projects'> {
  const { projects: _projects, ...rest } = state;
  return rest;
}
