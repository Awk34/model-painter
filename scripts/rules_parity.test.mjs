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

function getFunctionBlock(name) {
  const match = firestoreRules.match(new RegExp(`function ${name}\\b[\\s\\S]*?\\n\\s*\\}`));
  return match?.[0] ?? '';
}

test('USER_LIMITS match firestore.rules and storage.rules quotas', () => {
  const expectedPatterns = [
    ['MAX_TOTAL_USER_PHOTOS', getFunctionBlock('isValidUploadedPhotosList'), `photos\\.size\\(\\) <= ${readNumericLimit('MAX_TOTAL_USER_PHOTOS')}\\b`],
    ['MAX_PROJECT_PHOTOS_PER_PROJECT', getFunctionBlock('isValidProjectPhotosList'), `photos\\.size\\(\\) <= ${readNumericLimit('MAX_PROJECT_PHOTOS_PER_PROJECT')}\\b`],
    ['MAX_PHOTOS_PER_PROJECT_MODEL', getFunctionBlock('isValidProjectModelHead'), `entry\\.photos is list && entry\\.photos\\.size\\(\\) <= ${readNumericLimit('MAX_PHOTOS_PER_PROJECT_MODEL')}\\b`],
    ['MAX_PHOTOS_PER_PROJECT_MODEL (tail)', getFunctionBlock('isValidProjectModelTail'), `entry\\.photos is list && entry\\.photos\\.size\\(\\) <= ${readNumericLimit('MAX_PHOTOS_PER_PROJECT_MODEL')}\\b`],
    ['MAX_MODELS_PER_PROJECT', getFunctionBlock('isValidProjectModelsList'), `models\\.size\\(\\) <= ${readNumericLimit('MAX_MODELS_PER_PROJECT')}\\b`],
    ['MAX_MODEL_QUANTITY', getFunctionBlock('isValidProjectModelHead'), `entry\\.quantity <= ${readNumericLimit('MAX_MODEL_QUANTITY')}\\b`],
    ['MAX_MODEL_NOTE_LENGTH', getFunctionBlock('isValidProjectModelHead'), `entry\\.notes\\.size\\(\\) <= ${readNumericLimit('MAX_MODEL_NOTE_LENGTH')}\\b`],
    ['MAX_CONFIGURATIONS_PER_MODEL', getFunctionBlock('isValidProjectModelHead'), `entry\\.configurations is list && entry\\.configurations\\.size\\(\\) <= ${readNumericLimit('MAX_CONFIGURATIONS_PER_MODEL')}\\b`],
    ['MAX_COLORS_PER_PROJECT', getFunctionBlock('isValidProjectDoc'), `isValidStringIdList\\(proj\\.colorIds, ${readNumericLimit('MAX_COLORS_PER_PROJECT')}\\)`],
    ['MAX_NOTES_PER_PROJECT', getFunctionBlock('isValidProjectNotesList'), `notes\\.size\\(\\) <= ${readNumericLimit('MAX_NOTES_PER_PROJECT')}\\b`],
    ['MAX_NOTE_BLOCKS_PER_NOTE', getFunctionBlock('isValidProjectNoteHead'), `note\\.components is list && note\\.components\\.size\\(\\) <= ${readNumericLimit('MAX_NOTE_BLOCKS_PER_NOTE')}\\b`],
    ['MAX_NOTE_TEXT_LENGTH', getFunctionBlock('isValidNoteComponent'), `comp\\.value\\.size\\(\\) <= ${readNumericLimit('MAX_NOTE_TEXT_LENGTH')}\\b`],
    ['MAX_CUSTOM_PAINTS', getFunctionBlock('isValidCustomPaintsList'), `paints\\.size\\(\\) <= ${readNumericLimit('MAX_CUSTOM_PAINTS')}\\b`],
    ['MAX_INVENTORY_PAINTS', getFunctionBlock('isValidUserAccountState'), `isValidStringIdList\\(data\\.inventoryPaintIds, ${readNumericLimit('MAX_INVENTORY_PAINTS')}\\)`],
    ['MAX_WISHLIST_PAINTS', getFunctionBlock('isValidUserAccountState'), `isValidStringIdList\\(data\\.wishlistPaintIds, ${readNumericLimit('MAX_WISHLIST_PAINTS')}\\)`],
    ['MAX_INVENTORY_MODELS', getFunctionBlock('isValidUserAccountState'), `isValidStringIdList\\(data\\.inventoryModelIds, ${readNumericLimit('MAX_INVENTORY_MODELS')}\\)`],
    ['MAX_WISHLIST_MODELS', getFunctionBlock('isValidUserAccountState'), `isValidStringIdList\\(data\\.wishlistModelIds, ${readNumericLimit('MAX_WISHLIST_MODELS')}\\)`],
    ['MAX_PHOTO_CAPTION_LENGTH', getFunctionBlock('isValidUploadedPhotoCore'), `photo\\.caption\\.size\\(\\) <= ${readNumericLimit('MAX_PHOTO_CAPTION_LENGTH')}\\b`],
    ['MAX_PHOTO_FILE_SIZE_BYTES', getFunctionBlock('isValidUploadedPhotoCore'), `photo\\.sizeBytes <= ${readNumericLimit('MAX_PHOTO_FILE_SIZE_BYTES')}\\b`],
    [
      'MAX_COMPATIBILITY_OVERRIDE_KEYS / MAX_COMPATIBILITY_OVERRIDES_PER_PAINT',
      getFunctionBlock('isValidUserAccountState'),
      `isValidStringListMap\\(data\\.customCompatibilityOverrides, ${readNumericLimit('MAX_COMPATIBILITY_OVERRIDE_KEYS')}, ${readNumericLimit('MAX_COMPATIBILITY_OVERRIDES_PER_PAINT')}\\)`,
    ],
    [
      'MAX_MODEL_PROGRESS_KEYS / MAX_STEPS_PER_MODEL_PROGRESS',
      getFunctionBlock('isValidUserAccountState'),
      `isValidStringListMap\\(data\\.modelProgress, ${readNumericLimit('MAX_MODEL_PROGRESS_KEYS')}, ${readNumericLimit('MAX_STEPS_PER_MODEL_PROGRESS')}\\)`,
    ],
  ];

  for (const [label, block, pattern] of expectedPatterns) {
    assert.ok(new RegExp(pattern).test(block), `firestore.rules missing ${label}: /${pattern}/`);
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

  const customPaintBlock = getFunctionBlock('isValidCustomPaint');
  assert.ok(customPaintBlock.includes('paint.keys().hasOnly(['));
  assert.ok(customPaintBlock.includes("'potStyle'"));
  assert.ok(customPaintBlock.includes('paint.id is string'));
  assert.ok(customPaintBlock.includes('paint.name is string'));

  const prefsBlock = getFunctionBlock('isValidPreferences');
  assert.ok(prefsBlock.includes('prefs.keys().hasOnly(['));
  assert.ok(prefsBlock.includes("prefs.defaultRangeFilter in ['all', 'warhammer_colour', 'warhammer_pro']"));
  assert.ok(prefsBlock.includes('prefs.allowCompatibleSubstitutions is bool'));
  assert.ok(prefsBlock.includes('prefs.allowThirdPartySubstitutions is bool'));

  for (const fnName of ['isValidUploadedPhotoCore', 'isValidProjectPhotoCore', 'isValidUploadedPhotoLite']) {
    const block = getFunctionBlock(fnName);
    assert.ok(block.includes('photo.keys().hasOnly(['), `${fnName} missing keys().hasOnly`);
    assert.ok(block.includes('photo.targetType == expectedTargetType'), `${fnName} missing targetType check`);
    assert.ok(
      block.includes('isValidScopedStoragePath(photo.storagePath, userId, photo.kind, expectedTargetType)'),
      `${fnName} missing scoped storagePath check`
    );
  }

  assert.ok(getFunctionBlock('isValidUploadedPhotosList').includes(", 'model')"));
  assert.ok(getFunctionBlock('isValidProjectPhotosList').includes(", 'project')"));
  assert.ok(getFunctionBlock('isValidProjectModelHead').includes(", 'project_model')"));
  assert.ok(getFunctionBlock('isValidProjectModelTail').includes(", 'project_model')"));
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
