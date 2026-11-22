/**
 * Centralized validation & quota limits for user-uploaded photos and account entities.
 * Kept in sync with Firebase Security Rules (`firestore.rules` & `storage.rules`).
 */
export const USER_LIMITS = {
  // File upload constraints
  ALLOWED_IMAGE_MIME_TYPES: ['image/jpeg', 'image/png', 'image/webp'] as const,
  ALLOWED_IMAGE_EXTENSIONS_LABEL: 'JPG, PNG, or WebP',
  MAX_PHOTO_FILE_SIZE_BYTES: 5 * 1024 * 1024, // 5 MB stored limit (larger files auto-downscaled)
  MAX_PHOTO_FILE_SIZE_MB: 5,
  MAX_RAW_INPUT_FILE_SIZE_BYTES: 10 * 1024 * 1024, // 10 MB raw input guard before downscaling
  MAX_RAW_INPUT_FILE_SIZE_MB: 10,
  MAX_PHOTO_DIMENSION_PX: 2560, // Auto-downscale longest edge to 2560px when resizing
  MAX_PHOTO_CAPTION_LENGTH: 140,

  // Per-entity photo quantity limits
  MAX_MODEL_SHOWCASE_PHOTOS: 8,
  MAX_MODEL_REFERENCE_PHOTOS: 5,
  MAX_PROJECT_SHOWCASE_PHOTOS: 12,
  MAX_PROJECT_REFERENCE_PHOTOS: 6,
  MAX_TOTAL_USER_PHOTOS: 250,

  // Account collection & entity limits
  MAX_PROJECTS: 50,
  MAX_MODELS_PER_PROJECT: 100,
  MAX_COLORS_PER_PROJECT: 100,
  MAX_NOTES_PER_PROJECT: 50,
  MAX_NOTE_BLOCKS_PER_NOTE: 100,
  MAX_NOTE_TEXT_LENGTH: 2000,
  MAX_TITLE_LENGTH: 120,
  MAX_CUSTOM_PAINTS: 200,
  MAX_INVENTORY_PAINTS: 1000,
  MAX_WISHLIST_PAINTS: 500,
  MAX_INVENTORY_MODELS: 2000,
  MAX_WISHLIST_MODELS: 1000,
  MAX_COMPATIBILITY_OVERRIDE_KEYS: 500,
  MAX_COMPATIBILITY_OVERRIDES_PER_PAINT: 20,
  MAX_MODEL_PROGRESS_KEYS: 500,
  MAX_STEPS_PER_MODEL_PROGRESS: 200,
} as const;

export type AllowedImageMimeType = (typeof USER_LIMITS.ALLOWED_IMAGE_MIME_TYPES)[number];

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

