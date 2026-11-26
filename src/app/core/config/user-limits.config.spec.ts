import { USER_LIMITS, formatBytes } from './user-limits.config';

describe('user-limits.config', () => {
  it('formats byte sizes across B, KB, and MB thresholds', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1023)).toBe('1023 B');
    expect(formatBytes(1024)).toBe('1.0 KB');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(1024 * 1024 - 1)).toBe('1024.0 KB');
    expect(formatBytes(1024 * 1024)).toBe('1.00 MB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.00 MB');
  });

  it('maintains consistent quota and byte-size invariants', () => {
    expect(USER_LIMITS.MAX_PROJECTS).toBe(50);
    expect(USER_LIMITS.MAX_PHOTO_FILE_SIZE_BYTES).toBe(USER_LIMITS.MAX_PHOTO_FILE_SIZE_MB * 1024 * 1024);
    expect(USER_LIMITS.MAX_RAW_INPUT_FILE_SIZE_BYTES).toBe(
      USER_LIMITS.MAX_RAW_INPUT_FILE_SIZE_MB * 1024 * 1024
    );
    expect(USER_LIMITS.MAX_RAW_INPUT_FILE_SIZE_BYTES).toBeGreaterThanOrEqual(
      USER_LIMITS.MAX_PHOTO_FILE_SIZE_BYTES
    );

    expect(
      USER_LIMITS.MAX_PROJECT_MODEL_SHOWCASE_PHOTOS + USER_LIMITS.MAX_PROJECT_MODEL_REFERENCE_PHOTOS
    ).toBe(USER_LIMITS.MAX_PHOTOS_PER_PROJECT_MODEL);
    expect(
      USER_LIMITS.MAX_PROJECT_SHOWCASE_PHOTOS + USER_LIMITS.MAX_PROJECT_REFERENCE_PHOTOS
    ).toBe(USER_LIMITS.MAX_PROJECT_PHOTOS_PER_PROJECT);
    expect(USER_LIMITS.ALLOWED_IMAGE_MIME_TYPES).toEqual([
      'image/jpeg',
      'image/png',
      'image/webp',
    ]);
  });
});
