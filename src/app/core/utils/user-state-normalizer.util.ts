import { USER_LIMITS } from '../config/user-limits.config';
import {
  ProjectModelConfiguration,
  ProjectModelEntry,
  ProjectModelFeaturedImage,
  ThirdPartyCitadelMatch,
  ThirdPartyPaint,
  UserAccountState,
  UserPhotoKind,
  UserPhotoTargetType,
  UserPreferences,
  UserProject,
  UserProjectNote,
  UserProjectNoteComponent,
  UserUploadedPhoto,
} from '../models/catalog.models';
import { createEntityId } from './catalog-filter.util';

export const CURRENT_SCHEMA_VERSION = 2;

const UNSAFE_RECORD_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export function isSafeRecordKey(key: string): boolean {
  return Boolean(key) && !UNSAFE_RECORD_KEYS.has(key);
}

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
      if (v !== undefined && isSafeRecordKey(k)) {
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
  const normalized: string[] = [];
  for (const id of raw) {
    if (typeof id !== 'string' && typeof id !== 'number') {
      continue;
    }
    const trimmed = String(id).trim();
    if (trimmed) {
      normalized.push(trimmed.slice(0, 200));
    }
  }
  return Array.from(new Set(normalized)).slice(0, max);
}

export function clampModelQuantity(raw: unknown): number {
  const parsed = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(parsed)) {
    return 1;
  }
  return Math.min(USER_LIMITS.MAX_MODEL_QUANTITY, Math.max(1, Math.trunc(parsed)));
}

export function optionalTrimmedString(raw: unknown, maxLen: number): string | undefined {
  if (typeof raw !== 'string') {
    return undefined;
  }
  const trimmed = raw.trim();
  return trimmed ? trimmed.slice(0, maxLen) : undefined;
}

function extractIdArray(primaryIds: unknown, legacyObjects?: unknown): string[] {
  if (Array.isArray(primaryIds)) {
    return primaryIds
      .filter((id): id is string | number => typeof id === 'string' || typeof id === 'number')
      .map((id) => String(id))
      .filter(Boolean);
  }
  if (Array.isArray(legacyObjects)) {
    return (legacyObjects as Record<string, unknown>[])
      .map((item) => {
        const rawId = item?.['id'];
        return typeof rawId === 'string' || typeof rawId === 'number' ? String(rawId) : '';
      })
      .filter(Boolean);
  }
  return [];
}

function normalizePhotoEntry(
  raw: unknown,
  forcedTarget?: { targetType: UserPhotoTargetType; targetId: string }
): UserUploadedPhoto | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return null;
  }
  const ph = raw as Partial<UserUploadedPhoto>;
  const rawId = typeof ph.id === 'string' || typeof ph.id === 'number' ? String(ph.id) : '';
  const id = optionalTrimmedString(rawId, 120);
  if (!id || !isSafeRecordKey(id)) {
    return null;
  }
  const kind: UserPhotoKind = ph.kind === 'reference' ? 'reference' : 'showcase';
  const targetType: UserPhotoTargetType =
    forcedTarget?.targetType ??
    (ph.targetType === 'project' || ph.targetType === 'project_model' ? ph.targetType : 'model');
  const rawTargetId =
    forcedTarget?.targetId ??
    (typeof ph.targetId === 'string' || typeof ph.targetId === 'number' ? String(ph.targetId) : '');
  const targetId = optionalTrimmedString(rawTargetId, 200);
  if (!targetId) {
    return null;
  }

  const rawFileName =
    typeof ph.fileName === 'string' || typeof ph.fileName === 'number' ? String(ph.fileName) : '';
  const fileName = optionalTrimmedString(rawFileName, 255) ?? 'photo.jpg';
  const rawWidth = typeof ph.width === 'number' && Number.isFinite(ph.width) ? Math.trunc(ph.width) : 0;
  const rawHeight = typeof ph.height === 'number' && Number.isFinite(ph.height) ? Math.trunc(ph.height) : 0;

  return {
    id,
    targetType,
    targetId,
    kind,
    isPrivate: kind === 'reference' ? true : Boolean(ph.isPrivate ?? false),
    fileName,
    mimeType:
      ph.mimeType === 'image/png' || ph.mimeType === 'image/webp' ? ph.mimeType : 'image/jpeg',
    sizeBytes:
      typeof ph.sizeBytes === 'number' && Number.isFinite(ph.sizeBytes) && ph.sizeBytes > 0
        ? Math.max(1, Math.min(Math.trunc(ph.sizeBytes), USER_LIMITS.MAX_PHOTO_FILE_SIZE_BYTES))
        : 1,
    width: rawWidth > 0 && rawWidth <= 32768 ? rawWidth : undefined,
    height: rawHeight > 0 && rawHeight <= 32768 ? rawHeight : undefined,
    caption: optionalTrimmedString(ph.caption, USER_LIMITS.MAX_PHOTO_CAPTION_LENGTH),
    createdAt: optionalTrimmedString(ph.createdAt, 64) ?? new Date().toISOString(),
    storagePath: optionalTrimmedString(ph.storagePath, 512),
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

export function normalizeFeaturedImage(raw: unknown): ProjectModelFeaturedImage | undefined {
  if (!raw || typeof raw !== 'object') {
    return undefined;
  }
  const fi = raw as Record<string, unknown>;
  if (fi['source'] === 'uploaded_photo') {
    const photoId = optionalTrimmedString(fi['photoId'], 120);
    return photoId ? { source: 'uploaded_photo', photoId } : undefined;
  }
  if (fi['source'] === 'catalog_angle') {
    const rawIdx = fi['imageIndex'];
    let parsedIdx = Number.NaN;
    if (typeof rawIdx === 'number') {
      parsedIdx = rawIdx;
    } else if (typeof rawIdx === 'string' && rawIdx.trim() !== '') {
      parsedIdx = Number(rawIdx.trim());
    }
    const truncatedIdx = Math.trunc(parsedIdx);
    const idx = truncatedIdx === 0 ? 0 : truncatedIdx;
    if (!Number.isFinite(parsedIdx) || idx < 0 || idx > 50) {
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
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      continue;
    }
    const rec = item as Record<string, unknown>;
    const slot = optionalTrimmedString(rec['slot'], 120);
    const option = optionalTrimmedString(rec['option'], 200);
    if (!slot || !option) {
      continue;
    }
    normalized.push({
      id: optionalTrimmedString(rec['id'], 120) ?? `cfg_${i}`,
      slot,
      option,
      optionId: optionalTrimmedString(rec['optionId'], 200),
      notes: optionalTrimmedString(rec['notes'], 500),
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
  const safeDefaultTs = optionalTrimmedString(defaultTimestamp, 64) ?? new Date().toISOString();
  const rawComps = Array.isArray(rn['components'])
    ? rn['components'].filter(
        (c): c is Record<string, unknown> => Boolean(c && typeof c === 'object' && !Array.isArray(c))
      )
    : [];
  const components: UserProjectNoteComponent[] = rawComps
    .slice(0, USER_LIMITS.MAX_NOTE_BLOCKS_PER_NOTE)
    .map((rc) => {
      const compId = optionalTrimmedString(rc['id'], 120);
      const rawVal = rc['value'] ?? rc['text'];
      const textVal =
        typeof rawVal === 'string' || typeof rawVal === 'number' ? String(rawVal) : '';
      return {
        ...(compId ? { id: compId } : {}),
        type: rc['type'] === 'checkbox' ? 'checkbox' : 'text',
        value: textVal.slice(0, USER_LIMITS.MAX_NOTE_TEXT_LENGTH),
        checked: Boolean(rc['checked'] ?? false),
      };
    });

  return {
    id:
      optionalTrimmedString(rn['id'], 120) ??
      `note_${projectId.slice(0, 90)}_${idx}`.slice(0, 120),
    title:
      optionalTrimmedString(rn['title'] ?? rn['name'], USER_LIMITS.MAX_TITLE_LENGTH) ??
      'Project Note',
    createdAt: optionalTrimmedString(rn['createdAt'], 64) ?? safeDefaultTs,
    updatedAt: optionalTrimmedString(rn['updatedAt'], 64) ?? safeDefaultTs,
    components,
  };
}

function normalizeProjectModelEntry(
  raw: Record<string, unknown>,
  projectId: string,
  idx: number,
  defaultTimestamp: string,
  seenIds?: Set<string>
): ProjectModelEntry | null {
  const recipeId = optionalTrimmedString(raw['recipeId'], 200);
  if (!recipeId) {
    return null;
  }
  const fallbackId = `pmod_${projectId.slice(0, 90)}_${idx}`.slice(0, 120);
  let id = optionalTrimmedString(raw['id'], 120) ?? fallbackId;
  if (seenIds) {
    if (seenIds.has(id)) {
      id = createEntityId('pmod');
    }
    seenIds.add(id);
  }
  const safeDefaultTs = optionalTrimmedString(defaultTimestamp, 64) ?? new Date().toISOString();
  const createdAt = optionalTrimmedString(raw['createdAt'], 64) ?? safeDefaultTs;
  const updatedAt = optionalTrimmedString(raw['updatedAt'], 64) ?? createdAt;
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
    notes:
      typeof raw['notes'] === 'string'
        ? raw['notes'].slice(0, USER_LIMITS.MAX_MODEL_NOTE_LENGTH)
        : '',
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
    if (!rawEntry || typeof rawEntry !== 'object' || Array.isArray(rawEntry)) {
      continue;
    }
    const entry = normalizeProjectModelEntry(
      rawEntry as Record<string, unknown>,
      projectId,
      i,
      updatedAt,
      seenIds
    );
    if (!entry) {
      continue;
    }
    models.push(entry);
  }
  return models;
}

export function normalizeIncomingProject(rp: Record<string, unknown>): UserProject {
  const safeNow = new Date().toISOString();
  const id = optionalTrimmedString(rp['id'], 120) ?? createEntityId('proj');
  const name =
    optionalTrimmedString(rp['name'], USER_LIMITS.MAX_TITLE_LENGTH) ?? 'Imported Project';
  const createdAt = optionalTrimmedString(rp['createdAt'], 64) ?? safeNow;
  const updatedAt = optionalTrimmedString(rp['updatedAt'], 64) ?? createdAt;

  const models = normalizeProjectModels(rp, id, createdAt, updatedAt);

  const colorIds = Array.isArray(rp['colorIds'])
    ? rp['colorIds']
    : Array.isArray(rp['colourIds'])
    ? rp['colourIds']
    : extractIdArray(undefined, rp['colors'] ?? rp['colours']);

  const rawNotes = Array.isArray(rp['notes'])
    ? rp['notes'].filter(
        (rn): rn is Record<string, unknown> =>
          Boolean(rn && typeof rn === 'object' && !Array.isArray(rn))
      )
    : [];
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
  let coverPhotoId = optionalTrimmedString(rp['coverPhotoId'], 120);
  if (coverPhotoId && !photos.some((ph) => ph.id === coverPhotoId)) {
    coverPhotoId = undefined;
  }

  return {
    id,
    name,
    thumbnailUrl: optionalTrimmedString(thumbUrl, 2048),
    localThumbnailPath: optionalTrimmedString(localThumb, 512),
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
    const safeModelId = optionalTrimmedString(modelId, 200);
    if (!safeModelId || !isSafeRecordKey(safeModelId)) {
      continue;
    }
    const normalized = dedupeBoundedIds(stepIds, USER_LIMITS.MAX_STEPS_PER_MODEL_PROGRESS);
    if (normalized.length === 0) {
      continue;
    }
    if (Object.hasOwn(out, safeModelId)) {
      out[safeModelId] = Array.from(new Set([...out[safeModelId], ...normalized])).slice(
        0,
        USER_LIMITS.MAX_STEPS_PER_MODEL_PROGRESS
      );
    } else if (Object.keys(out).length < USER_LIMITS.MAX_MODEL_PROGRESS_KEYS) {
      out[safeModelId] = normalized;
    }
  }
  return out;
}

export function normalizeCustomPaints(raw: unknown): ThirdPartyPaint[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const out: ThirdPartyPaint[] = [];
  const seenIds = new Set<string>();
  for (const item of raw) {
    if (out.length >= USER_LIMITS.MAX_CUSTOM_PAINTS) {
      break;
    }
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      continue;
    }
    const p = item as Record<string, unknown>;
    const name = optionalTrimmedString(p['name'], USER_LIMITS.MAX_TITLE_LENGTH);
    if (!name) {
      continue;
    }
    const id = optionalTrimmedString(p['id'], 120) ?? createEntityId('custom');
    if (seenIds.has(id)) {
      continue;
    }
    seenIds.add(id);

    const rawMatches = Array.isArray(p['citadelMatches']) ? p['citadelMatches'] : [];
    const citadelMatches: ThirdPartyCitadelMatch[] = [];
    for (const mItem of rawMatches) {
      if (citadelMatches.length >= USER_LIMITS.MAX_COMPATIBILITY_OVERRIDES_PER_PAINT) {
        break;
      }
      if (!mItem || typeof mItem !== 'object' || Array.isArray(mItem)) {
        continue;
      }
      const m = mItem as Record<string, unknown>;
      const citadelPaintId = optionalTrimmedString(m['citadelPaintId'], 200);
      if (!citadelPaintId) {
        continue;
      }
      const quality =
        m['matchQuality'] === 'exact' ||
        m['matchQuality'] === 'close' ||
        m['matchQuality'] === 'similar'
          ? m['matchQuality']
          : 'close';
      const deltaE = typeof m['deltaE'] === 'number' && Number.isFinite(m['deltaE']) ? m['deltaE'] : 0;
      citadelMatches.push({
        citadelPaintId,
        citadelPaintName:
          optionalTrimmedString(m['citadelPaintName'], USER_LIMITS.MAX_TITLE_LENGTH) ?? '',
        citadelRange:
          optionalTrimmedString(m['citadelRange'], USER_LIMITS.MAX_TITLE_LENGTH) ?? '',
        citadelCategory: optionalTrimmedString(m['citadelCategory'], 64) ?? '',
        citadelHex: optionalTrimmedString(m['citadelHex'], 16) ?? '#888888',
        deltaE,
        matchQuality: quality,
      });
    }

    out.push({
      id,
      brand: optionalTrimmedString(p['brand'], USER_LIMITS.MAX_TITLE_LENGTH) ?? 'Custom Brand',
      range: optionalTrimmedString(p['range'], USER_LIMITS.MAX_TITLE_LENGTH) ?? 'Custom Range',
      code: optionalTrimmedString(p['code'], 64),
      name,
      category: optionalTrimmedString(p['category'], 64) ?? 'Layer',
      potStyle: optionalTrimmedString(p['potStyle'], 64),
      hex: optionalTrimmedString(p['hex'], 16) ?? '#888888',
      citadelMatches,
      isCustom: typeof p['isCustom'] === 'boolean' ? p['isCustom'] : true,
    });
  }
  return out;
}

export function normalizeCustomCompatibilityOverrides(raw: unknown): Record<string, string[]> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {};
  }
  const out: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const safeKey = optionalTrimmedString(k, 200);
    if (!safeKey || !isSafeRecordKey(safeKey)) {
      continue;
    }
    const ids = dedupeBoundedIds(v, USER_LIMITS.MAX_COMPATIBILITY_OVERRIDES_PER_PAINT);
    if (ids.length === 0) {
      continue;
    }
    if (Object.hasOwn(out, safeKey)) {
      out[safeKey] = Array.from(new Set([...out[safeKey], ...ids])).slice(
        0,
        USER_LIMITS.MAX_COMPATIBILITY_OVERRIDES_PER_PAINT
      );
    } else if (Object.keys(out).length < USER_LIMITS.MAX_COMPATIBILITY_OVERRIDE_KEYS) {
      out[safeKey] = ids;
    }
  }
  return out;
}

export function normalizePreferences(
  raw: unknown,
  fallback: UserPreferences = createDefaultState().preferences
): UserPreferences {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {
      ...fallback,
      preferredThirdPartyBrands: [...fallback.preferredThirdPartyBrands],
    };
  }
  const rec = raw as Record<string, unknown>;
  const rangeFilter =
    rec['defaultRangeFilter'] === 'all' ||
    rec['defaultRangeFilter'] === 'warhammer_colour' ||
    rec['defaultRangeFilter'] === 'warhammer_pro'
      ? rec['defaultRangeFilter']
      : fallback.defaultRangeFilter;

  return {
    defaultRangeFilter: rangeFilter,
    allowCompatibleSubstitutions:
      typeof rec['allowCompatibleSubstitutions'] === 'boolean'
        ? rec['allowCompatibleSubstitutions']
        : fallback.allowCompatibleSubstitutions,
    allowThirdPartySubstitutions:
      typeof rec['allowThirdPartySubstitutions'] === 'boolean'
        ? rec['allowThirdPartySubstitutions']
        : fallback.allowThirdPartySubstitutions,
    preferredThirdPartyBrands: Array.isArray(rec['preferredThirdPartyBrands'])
      ? dedupeBoundedIds(rec['preferredThirdPartyBrands'], 50)
      : [...fallback.preferredThirdPartyBrands],
  };
}

export function normalizeAccountState(raw: Partial<UserAccountState>): UserAccountState {
  const def = createDefaultState();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return def;
  }
  const rawProjects = Array.isArray(raw.projects)
    ? raw.projects.filter(
        (p): p is UserProject => Boolean(p && typeof p === 'object' && !Array.isArray(p))
      )
    : [];
  const rawPhotos = Array.isArray(raw.uploadedPhotos) ? raw.uploadedPhotos : [];
  const standalonePhotos = rawPhotos
    .map((item) => normalizePhotoEntry(item))
    .filter((ph): ph is UserUploadedPhoto => Boolean(ph && ph.targetType === 'model'))
    .slice(0, USER_LIMITS.MAX_TOTAL_USER_PHOTOS);

  const projects = rawProjects
    .slice(0, USER_LIMITS.MAX_PROJECTS)
    .map((p) => normalizeIncomingProject(p as unknown as Record<string, unknown>));

  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    updatedAt: optionalTrimmedString(raw.updatedAt, 64) ?? def.updatedAt,
    inventoryPaintIds: dedupeBoundedIds(raw.inventoryPaintIds, USER_LIMITS.MAX_INVENTORY_PAINTS),
    wishlistPaintIds: dedupeBoundedIds(raw.wishlistPaintIds, USER_LIMITS.MAX_WISHLIST_PAINTS),
    inventoryModelIds: dedupeBoundedIds(raw.inventoryModelIds, USER_LIMITS.MAX_INVENTORY_MODELS),
    wishlistModelIds: dedupeBoundedIds(raw.wishlistModelIds, USER_LIMITS.MAX_WISHLIST_MODELS),
    customPaints: normalizeCustomPaints(raw.customPaints),
    customCompatibilityOverrides: normalizeCustomCompatibilityOverrides(
      raw.customCompatibilityOverrides
    ),
    modelProgress: normalizeModelProgress(raw.modelProgress),
    projects,
    uploadedPhotos: standalonePhotos.slice(0, USER_LIMITS.MAX_TOTAL_USER_PHOTOS),
    preferences: normalizePreferences(raw.preferences, def.preferences),
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
