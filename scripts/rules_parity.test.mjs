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
const userAccountModelsSrc = fs.readFileSync(
  path.join(repoRoot, 'src/app/core/models/user-account.models.ts'),
  'utf8'
);
const normalizerSrc = fs.readFileSync(
  path.join(repoRoot, 'src/app/core/utils/user-state-normalizer.util.ts'),
  'utf8'
);
const cloudSyncSrc = fs.readFileSync(
  path.join(repoRoot, 'src/app/core/services/user-cloud-sync.service.ts'),
  'utf8'
);
const userStateSrc = fs.readFileSync(
  path.join(repoRoot, 'src/app/core/services/user-state.service.ts'),
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
  const maxOverridesPerPaint = readNumericLimit('MAX_COMPATIBILITY_OVERRIDES_PER_PAINT');
  assert.ok(customPaintBlock.includes('let matches = paint.citadelMatches;'));
  assert.ok(
    new RegExp(`matches is list && matches\\.size\\(\\) <= ${maxOverridesPerPaint}\\b`).test(customPaintBlock)
  );

  const customPaintLiteBlock = getFunctionBlock('isValidCustomPaintLite');
  assert.ok(customPaintLiteBlock.includes('paint.keys().hasOnly(['));
  assert.ok(customPaintLiteBlock.includes("'potStyle'"));
  assert.ok(
    new RegExp(`paint\\.citadelMatches is list && paint\\.citadelMatches\\.size\\(\\) <= ${maxOverridesPerPaint}\\b`).test(customPaintLiteBlock)
  );

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
    assert.ok(
      block.includes(`photo.sizeBytes <= ${readNumericLimit('MAX_PHOTO_FILE_SIZE_BYTES')}`),
      `${fnName} missing MAX_PHOTO_FILE_SIZE_BYTES check`
    );
    if (fnName === 'isValidUploadedPhotoCore') {
      assert.ok(block.includes('photo.isPrivate is bool'), `${fnName} missing isPrivate bool check`);
      assert.match(
        block,
        /\(photo\.kind == 'reference' \? photo\.isPrivate(?: == true)? : photo\.kind == 'showcase'\)/,
        `${fnName} missing private reference guard`
      );
    } else {
      assert.match(
        block,
        /\(photo\.kind == 'reference' \? photo\.isPrivate == true : photo\.kind == 'showcase'\)/,
        `${fnName} missing strict private reference guard`
      );
    }
  }

  assert.ok(getFunctionBlock('isValidUploadedPhotosList').includes(", 'model')"));
  assert.ok(getFunctionBlock('isValidProjectPhotosList').includes(", 'project')"));
  assert.ok(getFunctionBlock('isValidProjectModelHead').includes(", 'project_model')"));
  assert.ok(getFunctionBlock('isValidProjectModelTail').includes(", 'project_model')"));

  assert.ok(
    new RegExp(
      `entry\\.completedStepIds is list && entry\\.completedStepIds\\.size\\(\\) <= ${readNumericLimit('MAX_STEPS_PER_MODEL_PROGRESS')}\\b`
    ).test(getFunctionBlock('isValidProjectModelHead'))
  );
  assert.ok(getFunctionBlock('isValidProjectModelTail').includes('entry.keys().hasOnly(['));

  const projectDocBlock = getFunctionBlock('isValidProjectDoc');
  assert.ok(projectDocBlock.includes('proj.keys().hasOnly(['));
  assert.ok(projectDocBlock.includes('proj.id == projectId'));

  const projectMatchBlock = firestoreRules.match(/match \/projects\/\{projectId\}[\s\S]*?\n\s*\}/)?.[0] ?? '';
  assert.ok(
    projectMatchBlock.includes('request.resource.data.createdAt == resource.data.createdAt'),
    'projects/{projectId} update missing createdAt immutability'
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

test('MAX_PROJECTS (50) and MAX_TITLE_LENGTH (120) parity across config, services, and firestore.rules', () => {
  const maxProjects = readNumericLimit('MAX_PROJECTS');
  assert.equal(maxProjects, 50);
  // Firestore rules cannot count subcollection docs, so MAX_PROJECTS is enforced client-side in all 3 modules:
  assert.ok(normalizerSrc.includes('USER_LIMITS.MAX_PROJECTS'));
  assert.ok(cloudSyncSrc.includes('USER_LIMITS.MAX_PROJECTS'));
  assert.ok(userStateSrc.includes('USER_LIMITS.MAX_PROJECTS'));

  const maxTitleLength = readNumericLimit('MAX_TITLE_LENGTH');
  assert.equal(maxTitleLength, 120);
  const projectDocBlock = getFunctionBlock('isValidProjectDoc');
  const projNameMatch = projectDocBlock.match(/proj\.name\.size\(\)\s*<=\s*(\d+)/);
  assert.ok(projNameMatch, 'Missing proj.name.size() bound in isValidProjectDoc');
  assert.ok(maxTitleLength <= Number(projNameMatch[1]));

  const customPaintBlock = getFunctionBlock('isValidCustomPaint');
  assert.ok(customPaintBlock.includes(`paint.id.size() <= ${maxTitleLength}`));
  assert.ok(customPaintBlock.includes(`paint.name.size() <= ${maxTitleLength}`));
});

test('complete storage.rules security, targetType, payload, and default-deny parity', () => {
  assert.match(
    storageRules,
    /function isSignedInOwner\(userId\)\s*\{\s*return request\.auth != null && request\.auth\.uid == userId;\s*\}/
  );

  // UserPhotoTargetType parity across user-account.models.ts, firestore.rules, and storage.rules
  assert.ok(
    userAccountModelsSrc.includes("export type UserPhotoTargetType = 'model' | 'project' | 'project_model';")
  );
  assert.match(
    storageRules,
    /function isValidTargetType\(targetType\)\s*\{\s*return targetType in \['model', 'project', 'project_model'\];\s*\}/
  );

  const pathSegMatch = storageRules.match(/function isValidPathSegments\b[\s\S]*?\n\s*\}/)?.[0] ?? '';
  assert.ok(pathSegMatch.includes('targetId.size() > 0'));
  assert.ok(pathSegMatch.includes('targetId.size() <= 120'));
  assert.ok(pathSegMatch.includes("!(targetId in ['.', '..'])"));
  assert.ok(pathSegMatch.includes('fileName.size() > 0'));
  assert.ok(pathSegMatch.includes('fileName.size() <= 120'));
  assert.ok(pathSegMatch.includes("!(fileName in ['.', '..'])"));

  const payloadMatch = storageRules.match(/function isValidImagePayload\b[\s\S]*?\n\s*\}/)?.[0] ?? '';
  assert.equal(readNumericLimit('MAX_PHOTO_FILE_SIZE_BYTES'), 5 * 1024 * 1024);
  assert.ok(payloadMatch.includes('request.resource != null'));
  assert.ok(payloadMatch.includes('request.resource.size > 0'));
  assert.ok(payloadMatch.includes('request.resource.size <= 5 * 1024 * 1024'));
  assert.ok(
    payloadMatch.includes("request.resource.contentType in ['image/jpeg', 'image/png', 'image/webp']")
  );

  assert.match(
    storageRules,
    /match \/assets\/images\/\{allPaths=\*\*\}\s*\{\s*allow read:\s*if true;\s*allow write:\s*if false;\s*\}/
  );

  for (const folder of ['showcase', 'private_references']) {
    const block =
      storageRules.match(
        new RegExp(`match \\/users\\/\\{userId\\}\\/${folder}\\/\\{targetType\\}\\/\\{targetId\\}\\/\\{fileName\\}[\\s\\S]*?\\n\\s*\\}`)
      )?.[0] ?? '';
    assert.ok(block.includes('allow read: if isSignedInOwner(userId);'), `Missing read owner check for ${folder}`);
    assert.ok(
      block.includes('allow create, update: if isSignedInOwner(userId)') &&
        block.includes('isValidTargetType(targetType)') &&
        block.includes('isValidPathSegments(targetId, fileName)') &&
        block.includes('isValidImagePayload()'),
      `Missing create/update guards for ${folder}`
    );
    assert.ok(block.includes('allow delete: if isSignedInOwner(userId);'), `Missing delete owner check for ${folder}`);
  }

  assert.match(
    storageRules,
    /match \/\{allOtherPaths=\*\*\}\s*\{\s*allow read, write:\s*if false;\s*\}/
  );
});

test('UserMediaService.buildStoragePath cross-parity with firestore.rules isValidScopedStoragePath and storage.rules', () => {
  const scopedFn = getFunctionBlock('isValidScopedStoragePath');
  const patternMatch = scopedFn.match(
    /storagePath\.matches\(\s*'\^users\/'\s*\+\s*userId\s*\+\s*\(kind == 'reference' \? '\/private_references\/' : '\/showcase\/'\)\s*\+\s*targetType\s*\+\s*'([^']+)'\s*\)/
  );
  assert.ok(patternMatch, 'Could not extract trailing regex from isValidScopedStoragePath');
  const segmentTailRegex = patternMatch[1];

  function buildExpectedStoragePath(uid, photo) {
    const folder = photo.kind === 'reference' ? 'private_references' : 'showcase';
    const ext = photo.mimeType === 'image/png' ? 'png' : photo.mimeType === 'image/webp' ? 'webp' : 'jpg';
    const safeTargetId = photo.targetId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 100) || 'item';
    const safePhotoId = photo.id.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 110) || 'photo';
    return `users/${uid}/${folder}/${photo.targetType}/${safeTargetId}/${safePhotoId}.${ext}`;
  }

  assert.ok(userMediaSrc.includes("const folder = photo.kind === 'reference' ? 'private_references' : 'showcase';"));

  const uid = 'user_abc-123';
  for (const kind of ['showcase', 'reference']) {
    for (const targetType of ['model', 'project', 'project_model']) {
      for (const mimeType of ['image/jpeg', 'image/png', 'image/webp']) {
        const storagePath = buildExpectedStoragePath(uid, {
          id: `${'p'.repeat(130)}/../evil`,
          targetId: `${'t'.repeat(130)}/../../etc`,
          kind,
          targetType,
          mimeType,
        });
        const expectedFolder = kind === 'reference' ? 'private_references' : 'showcase';
        const re = new RegExp(`^users/${uid}/${expectedFolder}/${targetType}${segmentTailRegex}`);
        assert.match(storagePath, re, `Valid path failed regex: ${storagePath}`);

        const parts = storagePath.split('/');
        assert.equal(parts.length, 6);
        assert.ok(parts[4].length > 0 && parts[4].length <= 120);
        assert.ok(parts[5].length > 0 && parts[5].length <= 120);
        assert.ok(!['.', '..'].includes(parts[4]));
        assert.ok(!['.', '..'].includes(parts[5]));
      }
    }
  }

  const invalidCases = [
    // Mismatched kind -> folder
    {
      path: `users/${uid}/showcase/model/m1/p1.jpg`,
      re: new RegExp(`^users/${uid}/private_references/model${segmentTailRegex}`),
    },
    // Mismatched uid
    {
      path: `users/other_uid/showcase/model/m1/p1.jpg`,
      re: new RegExp(`^users/${uid}/showcase/model${segmentTailRegex}`),
    },
    // Traversal dot segments
    {
      path: `users/${uid}/showcase/model/../p1.jpg`,
      re: new RegExp(`^users/${uid}/showcase/model${segmentTailRegex}`),
    },
    {
      path: `users/${uid}/showcase/model/m1/..`,
      re: new RegExp(`^users/${uid}/showcase/model${segmentTailRegex}`),
    },
  ];

  for (const c of invalidCases) {
    assert.doesNotMatch(c.path, c.re, `Invalid path unexpectedly matched: ${c.path}`);
  }
});
