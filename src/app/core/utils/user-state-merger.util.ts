import { USER_LIMITS } from '../config/user-limits.config';
import {
  ThirdPartyPaint,
  UserAccountState,
  UserProject,
  UserUploadedPhoto,
} from '../models/catalog.models';
import {
  createDefaultState,
  isSafeRecordKey,
  normalizeAccountState,
  normalizePreferences,
} from './user-state-normalizer.util';

function mergeBoundedStringListMap(
  baseMap: Record<string, string[]> | undefined,
  incomingMap: Record<string, string[]> | undefined,
  maxKeys: number,
  maxItemsPerKey: number
): Record<string, string[]> {
  const merged: Record<string, string[]> = {};
  for (const [key, existingItems] of Object.entries(baseMap ?? {})) {
    if (isSafeRecordKey(key)) {
      merged[key] = existingItems;
    }
  }
  for (const [key, incomingItems] of Object.entries(incomingMap ?? {})) {
    if (!isSafeRecordKey(key)) {
      continue;
    }
    const hasKey = Object.hasOwn(merged, key);
    if (!hasKey && Object.keys(merged).length >= maxKeys) {
      break;
    }
    const combined = Array.from(
      new Set([...(hasKey ? merged[key] : []), ...incomingItems])
    ).slice(0, maxItemsPerKey);
    if (combined.length > 0) {
      merged[key] = combined;
    }
  }
  return merged;
}

export function mergeUserAccountState(
  prev: UserAccountState,
  rawPayload: Record<string, unknown>,
  mode: 'merge' | 'replace' = 'merge'
): UserAccountState {
  const base = mode === 'replace' ? createDefaultState() : prev;
  const incoming = normalizeAccountState(rawPayload as Partial<UserAccountState>);

  const invSet = new Set([...base.inventoryPaintIds, ...incoming.inventoryPaintIds]);
  const wishSet = new Set([...base.wishlistPaintIds, ...incoming.wishlistPaintIds]);
  for (const id of invSet) {
    wishSet.delete(id);
  }

  const modelInvSet = new Set([...base.inventoryModelIds, ...incoming.inventoryModelIds]);
  const modelWishSet = new Set([...base.wishlistModelIds, ...incoming.wishlistModelIds]);
  for (const id of modelInvSet) {
    modelWishSet.delete(id);
  }

  const projectMap = new Map<string, UserProject>(base.projects.map((p) => [p.id, p]));
  for (const incomingP of incoming.projects) {
    const existing = projectMap.get(incomingP.id);
    if (existing) {
      if (incomingP.updatedAt >= existing.updatedAt) {
        projectMap.set(incomingP.id, {
          ...incomingP,
          createdAt: existing.createdAt,
        });
      }
    } else if (projectMap.size < USER_LIMITS.MAX_PROJECTS) {
      projectMap.set(incomingP.id, incomingP);
    }
  }

  const customPaintMap = new Map<string, ThirdPartyPaint>();
  for (const cp of [...base.customPaints, ...incoming.customPaints]) {
    if (customPaintMap.has(cp.id) || customPaintMap.size < USER_LIMITS.MAX_CUSTOM_PAINTS) {
      customPaintMap.set(cp.id, cp);
    }
  }

  const photoMap = new Map<string, UserUploadedPhoto>();
  for (const ph of [...base.uploadedPhotos, ...incoming.uploadedPhotos]) {
    if (
      ph.targetType === 'model' &&
      (photoMap.has(ph.id) || photoMap.size < USER_LIMITS.MAX_TOTAL_USER_PHOTOS)
    ) {
      photoMap.set(ph.id, {
        ...ph,
        isPrivate: ph.kind === 'reference' ? true : Boolean(ph.isPrivate),
      });
    }
  }

  const mergedProgress = mergeBoundedStringListMap(
    base.modelProgress,
    incoming.modelProgress,
    USER_LIMITS.MAX_MODEL_PROGRESS_KEYS,
    USER_LIMITS.MAX_STEPS_PER_MODEL_PROGRESS
  );

  const mergedOverrides = mergeBoundedStringListMap(
    base.customCompatibilityOverrides,
    incoming.customCompatibilityOverrides,
    USER_LIMITS.MAX_COMPATIBILITY_OVERRIDE_KEYS,
    USER_LIMITS.MAX_COMPATIBILITY_OVERRIDES_PER_PAINT
  );

  const hasRawPreferences =
    Object.hasOwn(rawPayload, 'preferences') &&
    Boolean(rawPayload['preferences']) &&
    typeof rawPayload['preferences'] === 'object' &&
    !Array.isArray(rawPayload['preferences']);
  const mergedPreferences = hasRawPreferences
    ? normalizePreferences(rawPayload['preferences'], base.preferences)
    : {
        ...base.preferences,
        preferredThirdPartyBrands: [...base.preferences.preferredThirdPartyBrands],
      };

  return {
    ...base,
    inventoryPaintIds: Array.from(invSet).slice(0, USER_LIMITS.MAX_INVENTORY_PAINTS),
    wishlistPaintIds: Array.from(wishSet).slice(0, USER_LIMITS.MAX_WISHLIST_PAINTS),
    inventoryModelIds: Array.from(modelInvSet).slice(0, USER_LIMITS.MAX_INVENTORY_MODELS),
    wishlistModelIds: Array.from(modelWishSet).slice(0, USER_LIMITS.MAX_WISHLIST_MODELS),
    customPaints: Array.from(customPaintMap.values()),
    customCompatibilityOverrides: mergedOverrides,
    modelProgress: mergedProgress,
    projects: Array.from(projectMap.values()),
    uploadedPhotos: Array.from(photoMap.values()),
    preferences: mergedPreferences,
  };
}
