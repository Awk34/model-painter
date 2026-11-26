import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

const limitsSrc = fs.readFileSync(
  path.join(repoRoot, 'src/app/core/config/user-limits.config.ts'),
  'utf8'
);
const firestoreRules = fs.readFileSync(path.join(repoRoot, 'firestore.rules'), 'utf8');
const storageRules = fs.readFileSync(path.join(repoRoot, 'storage.rules'), 'utf8');
const userMediaSrc = fs.readFileSync(
  path.join(repoRoot, 'src/app/core/services/user-media.service.ts'),
  'utf8'
);

function readNumericLimit(name) {
  const match = limitsSrc.match(new RegExp(`${name}:\\s*([^,\\n]+)`));
  assert.ok(match, `Missing ${name} in user-limits.config.ts`);
  const expr = match[1].replace(/\/\/.*$/, '').trim();
  if (/^\d+$/.test(expr)) {
    return Number(expr);
  }
  if (expr === '5 * 1024 * 1024') {
    return 5 * 1024 * 1024;
  }
  assert.fail(`Unsupported limit expression for ${name}: ${expr}`);
}

test('USER_LIMITS match firestore.rules and storage.rules quotas', () => {
  const expectedLimits = [
    ['MAX_TOTAL_USER_PHOTOS', `isValidList(photos, ${readNumericLimit('MAX_TOTAL_USER_PHOTOS')})`],
    ['MAX_PROJECT_PHOTOS_PER_PROJECT', `isValidList(photos, ${readNumericLimit('MAX_PROJECT_PHOTOS_PER_PROJECT')})`],
    ['MAX_PHOTOS_PER_PROJECT_MODEL', `isValidList(photos, ${readNumericLimit('MAX_PHOTOS_PER_PROJECT_MODEL')})`],
    ['MAX_MODELS_PER_PROJECT', `isValidList(models, ${readNumericLimit('MAX_MODELS_PER_PROJECT')})`],
    ['MAX_MODEL_QUANTITY', `entry.quantity <= ${readNumericLimit('MAX_MODEL_QUANTITY')}`],
    ['MAX_MODEL_NOTE_LENGTH', `entry.notes.size() <= ${readNumericLimit('MAX_MODEL_NOTE_LENGTH')}`],
    ['MAX_CONFIGURATIONS_PER_MODEL', `isValidList(configs, ${readNumericLimit('MAX_CONFIGURATIONS_PER_MODEL')})`],
    ['MAX_COLORS_PER_PROJECT', `isValidStringIdList(proj.colorIds, ${readNumericLimit('MAX_COLORS_PER_PROJECT')})`],
    ['MAX_NOTES_PER_PROJECT', `isValidList(notes, ${readNumericLimit('MAX_NOTES_PER_PROJECT')})`],
    ['MAX_NOTE_BLOCKS_PER_NOTE', `isValidList(comps, ${readNumericLimit('MAX_NOTE_BLOCKS_PER_NOTE')})`],
    ['MAX_NOTE_TEXT_LENGTH', `comp.value.size() <= ${readNumericLimit('MAX_NOTE_TEXT_LENGTH')}`],
    ['MAX_CUSTOM_PAINTS', `isValidList(paints, ${readNumericLimit('MAX_CUSTOM_PAINTS')})`],
    ['MAX_INVENTORY_PAINTS', `isValidStringIdList(data.inventoryPaintIds, ${readNumericLimit('MAX_INVENTORY_PAINTS')})`],
    ['MAX_WISHLIST_PAINTS', `isValidStringIdList(data.wishlistPaintIds, ${readNumericLimit('MAX_WISHLIST_PAINTS')})`],
    ['MAX_INVENTORY_MODELS', `isValidStringIdList(data.inventoryModelIds, ${readNumericLimit('MAX_INVENTORY_MODELS')})`],
    ['MAX_WISHLIST_MODELS', `isValidStringIdList(data.wishlistModelIds, ${readNumericLimit('MAX_WISHLIST_MODELS')})`],
    ['MAX_PHOTO_CAPTION_LENGTH', `isOptStr(photo.get('caption', null), ${readNumericLimit('MAX_PHOTO_CAPTION_LENGTH')})`],
    ['MAX_PHOTO_FILE_SIZE_BYTES', `photo.sizeBytes <= ${readNumericLimit('MAX_PHOTO_FILE_SIZE_BYTES')}`],
    [
      'MAX_COMPATIBILITY_OVERRIDE_KEYS / MAX_COMPATIBILITY_OVERRIDES_PER_PAINT',
      `isValidStringListMap(data.customCompatibilityOverrides, ${readNumericLimit('MAX_COMPATIBILITY_OVERRIDE_KEYS')}, ${readNumericLimit('MAX_COMPATIBILITY_OVERRIDES_PER_PAINT')})`,
    ],
    [
      'MAX_MODEL_PROGRESS_KEYS / MAX_STEPS_PER_MODEL_PROGRESS',
      `isValidStringListMap(data.modelProgress, ${readNumericLimit('MAX_MODEL_PROGRESS_KEYS')}, ${readNumericLimit('MAX_STEPS_PER_MODEL_PROGRESS')})`,
    ],
  ];

  for (const [label, snippet] of expectedLimits) {
    assert.ok(firestoreRules.includes(snippet), `firestore.rules missing ${label}: ${snippet}`);
  }
});

test('firestore.rules removes dead uid helpers and unused public collections, and hardens customPaints, preferences, and photos', () => {
  assert.equal(firestoreRules.includes('uidUnchanged'), false);
  assert.equal(firestoreRules.includes('uidNotModified'), false);

  for (const unusedCol of [
    'match /paints/{docId}',
    'match /paint_compatibility/{docId}',
    'match /third_party_paints/{docId}',
    'match /colour_groups/{docId}',
    'match /games/{docId}',
    'match /factions/{docId}',
  ]) {
    assert.equal(
      firestoreRules.includes(unusedCol),
      false,
      `Unused collection rule still present: ${unusedCol}`
    );
  }

  for (const activeCol of [
    'match /catalog_meta/{docId}',
    'match /colours/{docId}',
    'match /recipes/{docId}',
  ]) {
    assert.ok(firestoreRules.includes(activeCol), `Missing active catalog rule: ${activeCol}`);
  }

  const customPaintBlock = firestoreRules.match(/function isValidCustomPaint[\s\S]*?\n\s*\}/)?.[0] ?? '';
  assert.ok(customPaintBlock.includes('hasOnlyAllowedFields(paint,'));
  assert.ok(customPaintBlock.includes("'potStyle'"));
  assert.ok(customPaintBlock.includes('paint.keys().hasAll('));

  const prefsBlock = firestoreRules.match(/function isValidPreferences[\s\S]*?\n\s*\}/)?.[0] ?? '';
  assert.ok(prefsBlock.includes('hasOnlyAllowedFields(prefs,'));
  assert.ok(prefsBlock.includes('prefs.keys().hasAll('));

  const photoCoreBlock = firestoreRules.match(/function isValidUploadedPhotoCore[\s\S]*?\n\s*\}/)?.[0] ?? '';
  assert.ok(photoCoreBlock.includes("photo.targetType in ['model', 'project', 'project_model']"));
  assert.ok(
    photoCoreBlock.includes(
      'isScopedStoragePath(photo.storagePath, userId, photo.kind, photo.targetType)'
    )
  );
});

test('storage.rules and UserMediaService align on filename length <= 120, dot-segment rejection, and explicit content types', () => {
  assert.ok(storageRules.includes("!(targetId in ['.', '..'])"));
  assert.ok(storageRules.includes("!(fileName in ['.', '..'])"));
  assert.ok(storageRules.includes('fileName.size() <= 120'));
  assert.ok(
    storageRules.includes("request.resource.contentType in ['image/jpeg', 'image/png', 'image/webp']")
  );
  assert.ok(userMediaSrc.includes('.slice(0, 110)'));
  assert.ok(userMediaSrc.includes('.slice(0, 100)'));
});
