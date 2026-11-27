import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const rulesPath = path.join(repoRoot, 'firestore.rules');
const jarPath =
  process.env.FIRESTORE_EMULATOR_JAR ||
  path.join(os.homedir(), '.cache', 'firebase', 'emulators', 'cloud-firestore-emulator-v1.22.0.jar');

const hasJar = fs.existsSync(jarPath);
const hasJava = spawnSync('java', ['-version'], { stdio: 'ignore' }).status === 0;
const emulatorAvailable = hasJar && hasJava;
const requireEmulator = process.env.REQUIRE_FIRESTORE_EMULATOR === '1';

if (!emulatorAvailable && requireEmulator) {
  throw new Error(
    `REQUIRE_FIRESTORE_EMULATOR=1 is set, but emulator runtime is unavailable (hasJava=${hasJava}, hasJar=${hasJar}, jarPath=${jarPath}).`
  );
}

const PROJECT_ID = 'model-painter-rules-test';

function findFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      server.close((err) => {
        if (err) reject(err);
        else resolve(port);
      });
    });
  });
}

function base64Url(obj) {
  return Buffer.from(JSON.stringify(obj), 'utf8').toString('base64url');
}

function makeAuthJwt(uid, projectId = PROJECT_ID) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url({ alg: 'none', typ: 'JWT' });
  const payload = base64Url({
    iss: `https://securetoken.google.com/${projectId}`,
    aud: projectId,
    auth_time: now,
    user_id: uid,
    sub: uid,
    iat: now,
    exp: now + 3600,
    firebase: {
      identities: {},
      sign_in_provider: 'custom',
    },
  });
  return `${header}.${payload}.`;
}

function toFirestoreValue(val) {
  if (val === null) {
    return { nullValue: null };
  }
  if (typeof val === 'boolean') {
    return { booleanValue: val };
  }
  if (typeof val === 'number') {
    if (Number.isInteger(val)) {
      return { integerValue: String(val) };
    }
    return { doubleValue: val };
  }
  if (typeof val === 'string') {
    return { stringValue: val };
  }
  if (Array.isArray(val)) {
    return {
      arrayValue: {
        values: val.map((item) => toFirestoreValue(item)),
      },
    };
  }
  if (typeof val === 'object') {
    return {
      mapValue: {
        fields: toFirestoreFields(val),
      },
    };
  }
  throw new TypeError(`Unsupported Firestore value type: ${typeof val}`);
}

function toFirestoreFields(obj) {
  const fields = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) {
      fields[k] = toFirestoreValue(v);
    }
  }
  return fields;
}

function toFirestoreDoc(obj) {
  return { fields: toFirestoreFields(obj) };
}

function validPhoto(overrides = {}) {
  return {
    id: 'ph_1',
    targetType: 'model',
    targetId: 'm1',
    kind: 'showcase',
    isPrivate: false,
    fileName: 'photo.jpg',
    mimeType: 'image/jpeg',
    sizeBytes: 1024,
    width: 800,
    height: 600,
    caption: 'Nice paintjob',
    createdAt: '2026-01-01T00:00:00Z',
    storagePath: 'users/userA/showcase/model/m1/ph_1.jpg',
    ...overrides,
  };
}

function validCustomPaint(overrides = {}) {
  return {
    id: 'cp_1',
    brand: 'Vallejo',
    range: 'Model Color',
    code: '70.950',
    name: 'Black',
    category: 'Base',
    potStyle: 'dropper_bottle',
    hex: '#111111',
    citadelMatches: [
      {
        citadelPaintId: 'cit_abaddon',
        citadelPaintName: 'Abaddon Black',
        citadelRange: 'warhammer_colour',
        citadelCategory: 'Base',
        citadelHex: '#000000',
        deltaE: 1.1,
        matchQuality: 'exact',
      },
    ],
    isCustom: true,
    ...overrides,
  };
}

function validAccountState(overrides = {}) {
  return {
    schemaVersion: 2,
    updatedAt: '2026-01-01T00:00:00Z',
    inventoryPaintIds: ['p1'],
    wishlistPaintIds: ['p2'],
    inventoryModelIds: ['m1'],
    wishlistModelIds: ['m2'],
    customPaints: [validCustomPaint()],
    customCompatibilityOverrides: { cit_abaddon: ['cp_1'] },
    modelProgress: { m1: ['step_1'] },
    uploadedPhotos: [validPhoto()],
    preferences: {
      defaultRangeFilter: 'all',
      allowCompatibleSubstitutions: true,
      allowThirdPartySubstitutions: true,
      preferredThirdPartyBrands: ['Vallejo'],
    },
    ...overrides,
  };
}

function validProjectModel(overrides = {}) {
  return {
    id: 'pmod_1',
    recipeId: 'm1',
    customName: 'Sergeant',
    quantity: 1,
    notes: 'Thin coats',
    completedStepIds: ['s1'],
    featuredImage: {
      source: 'catalog_angle',
      imageIndex: 0,
      modelId: 'm1',
    },
    photos: [
      validPhoto({
        id: 'pm_ph_1',
        targetType: 'project_model',
        targetId: 'pmod_1',
        storagePath: 'users/userA/showcase/project_model/pmod_1/pm_ph_1.jpg',
      }),
    ],
    configurations: [
      {
        id: 'cfg_1',
        slot: 'Weapon',
        option: 'Plasma',
        optionId: 'opt_1',
        notes: 'Blue glow',
      },
    ],
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function validProject(overrides = {}) {
  return {
    id: 'proj_1',
    name: 'Ultramarines 2nd Company',
    thumbnailUrl: null,
    localThumbnailPath: null,
    coverPhotoId: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    colorIds: ['c1'],
    notes: [
      {
        id: 'note_1',
        title: 'Primer',
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
        components: [{ id: 'blk_1', type: 'checkbox', value: 'Prime black', checked: false }],
      },
    ],
    photos: [
      validPhoto({
        id: 'proj_ph_1',
        targetType: 'project',
        targetId: 'proj_1',
        storagePath: 'users/userA/showcase/project/proj_1/proj_ph_1.jpg',
      }),
    ],
    models: [validProjectModel()],
    ...overrides,
  };
}

describe(
  'firestore.rules automated emulator verification',
  emulatorAvailable ? {} : { skip: 'Java or cloud-firestore-emulator JAR unavailable' },
  () => {
    let port = 0;
    let baseUrl = '';
    let child = null;
    let tokenA = '';
    let tokenB = '';
    const emulatorLogs = [];
    let cleanupHandlersRegistered = false;
    let signalCleanupStarted = false;

    function isChildAlive(proc) {
      return Boolean(proc && proc.exitCode === null && proc.signalCode === null);
    }

    function killChildForcefully() {
      if (!isChildAlive(child)) {
        return;
      }
      try {
        child.kill('SIGKILL');
      } catch {
        // Ignore ESRCH if the child already exited.
      }
    }

    async function stopChild(timeoutMs = 5000) {
      if (!isChildAlive(child)) {
        return;
      }
      const proc = child;
      await new Promise((resolve) => {
        let termTimer = null;
        let killTimer = null;
        const finish = () => {
          if (termTimer) {
            clearTimeout(termTimer);
            termTimer = null;
          }
          if (killTimer) {
            clearTimeout(killTimer);
            killTimer = null;
          }
          proc.removeListener('exit', finish);
          resolve();
        };

        proc.once('exit', finish);
        try {
          proc.kill('SIGTERM');
        } catch {
          finish();
          return;
        }

        termTimer = setTimeout(() => {
          termTimer = null;
          if (!isChildAlive(proc)) {
            finish();
            return;
          }
          try {
            proc.kill('SIGKILL');
          } catch {
            finish();
            return;
          }
          killTimer = setTimeout(finish, 500);
        }, timeoutMs);
      });
    }

    const onProcessExit = () => {
      killChildForcefully();
    };

    const handleTerminationSignal = (signal) => {
      const sigNum = os.constants.signals[signal] ?? (signal === 'SIGINT' ? 2 : 15);
      if (signalCleanupStarted) {
        killChildForcefully();
        unregisterCleanupHandlers();
        process.exit(128 + sigNum);
        return;
      }
      signalCleanupStarted = true;
      void stopChild(1500).finally(() => {
        unregisterCleanupHandlers();
        process.exit(128 + sigNum);
      });
    };

    const onSigInt = () => handleTerminationSignal('SIGINT');
    const onSigTerm = () => handleTerminationSignal('SIGTERM');

    function registerCleanupHandlers() {
      if (cleanupHandlersRegistered) {
        return;
      }
      cleanupHandlersRegistered = true;
      process.on('SIGINT', onSigInt);
      process.on('SIGTERM', onSigTerm);
      process.on('exit', onProcessExit);
    }

    function unregisterCleanupHandlers() {
      if (!cleanupHandlersRegistered) {
        return;
      }
      cleanupHandlersRegistered = false;
      process.removeListener('SIGINT', onSigInt);
      process.removeListener('SIGTERM', onSigTerm);
      process.removeListener('exit', onProcessExit);
    }

    async function waitForEmulatorReady() {
      const deadline = Date.now() + 20_000;
      let lastErr;
      while (Date.now() < deadline) {
        if (child && child.exitCode !== null) {
          throw new Error(
            `Firestore emulator exited early with code ${child.exitCode}: ${emulatorLogs.join('')}`
          );
        }
        try {
          const resp = await fetch(`${baseUrl}/`);
          if (resp.status < 500) {
            return;
          }
        } catch (err) {
          lastErr = err;
        }
        await new Promise((r) => setTimeout(r, 150));
      }
      throw new Error(
        `Timed out waiting for Firestore emulator readiness: ${lastErr}\n${emulatorLogs.join('')}`
      );
    }

    async function fsRequest({ method = 'GET', docPath, body, token, query = '' }) {
      const headers = {};
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }
      if (body !== undefined) {
        headers['Content-Type'] = 'application/json';
      }
      const url = `${baseUrl}/v1/projects/${PROJECT_ID}/databases/(default)/documents${docPath}${query}`;
      const resp = await fetch(url, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(toFirestoreDoc(body)) : undefined,
      });
      const text = await resp.text();
      return {
        status: resp.status,
        body: text ? JSON.parse(text) : null,
      };
    }

    before(async () => {
      port = await findFreePort();
      baseUrl = `http://127.0.0.1:${port}`;
      tokenA = makeAuthJwt('userA');
      tokenB = makeAuthJwt('userB');

      child = spawn(
        'java',
        [
          '-jar',
          jarPath,
          '--host',
          '127.0.0.1',
          '--port',
          String(port),
          '--project_id',
          PROJECT_ID,
          '--single_project_mode',
        ],
        { stdio: ['ignore', 'pipe', 'pipe'] }
      );
      registerCleanupHandlers();
      child.on('error', (err) => {
        emulatorLogs.push(err.message);
      });
      const recordLog = (chunk) => {
        emulatorLogs.push(chunk.toString('utf8'));
        if (emulatorLogs.length > 50) {
          emulatorLogs.shift();
        }
      };
      child.stdout?.on('data', recordLog);
      child.stderr?.on('data', recordLog);

      await waitForEmulatorReady();

      const rulesContent = fs.readFileSync(rulesPath, 'utf8');
      const uploadResp = await fetch(
        `${baseUrl}/emulator/v1/projects/${PROJECT_ID}:securityRules`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            rules: {
              files: [{ name: 'firestore.rules', content: rulesContent }],
            },
          }),
        }
      );
      assert.equal(uploadResp.status, 200, `Failed to upload firestore.rules: ${await uploadResp.text()}`);
    });

    after(async () => {
      try {
        await stopChild(5000);
      } finally {
        unregisterCleanupHandlers();
        child = null;
      }
    });

    beforeEach(async () => {
      const clearResp = await fetch(
        `${baseUrl}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`,
        { method: 'DELETE' }
      );
      assert.equal(clearResp.status, 200);
    });

    it('enforces public read-only catalog collections and default deny on unknown paths', async () => {
      for (const pathItem of ['/catalog_meta/manifest', '/colours/c1', '/recipes/r1']) {
        const seed = await fsRequest({
          method: 'PATCH',
          docPath: pathItem,
          body: { id: 'seed' },
          token: 'owner',
        });
        assert.equal(seed.status, 200);

        const anonGet = await fsRequest({ method: 'GET', docPath: pathItem });
        assert.equal(anonGet.status, 200);

        const anonPatch = await fsRequest({
          method: 'PATCH',
          docPath: pathItem,
          body: { id: 'hack' },
        });
        assert.equal(anonPatch.status, 403);

        const userPatch = await fsRequest({
          method: 'PATCH',
          docPath: pathItem,
          body: { id: 'hack' },
          token: tokenA,
        });
        assert.equal(userPatch.status, 403);

        const userDelete = await fsRequest({
          method: 'DELETE',
          docPath: pathItem,
          token: tokenA,
        });
        assert.equal(userDelete.status, 403);
      }

      assert.equal((await fsRequest({ method: 'GET', docPath: '/other/doc1' })).status, 403);
      assert.equal(
        (await fsRequest({ method: 'GET', docPath: '/other/doc1', token: tokenA })).status,
        403
      );
      assert.equal(
        (
          await fsRequest({
            method: 'PATCH',
            docPath: '/other/doc1',
            body: { ok: true },
            token: tokenA,
          })
        ).status,
        403
      );
    });

    it('blocks unauthenticated and cross-user access to /users/{uid} and /users/{uid}/projects/{projectId}', async () => {
      assert.equal(
        (
          await fsRequest({
            method: 'PATCH',
            docPath: '/users/userA',
            body: validAccountState(),
            token: tokenA,
          })
        ).status,
        200
      );
      assert.equal(
        (
          await fsRequest({
            method: 'POST',
            docPath: '/users/userA/projects',
            query: '?documentId=proj_1',
            body: validProject(),
            token: tokenA,
          })
        ).status,
        200
      );

      for (const badToken of [undefined, tokenB]) {
        assert.equal(
          (await fsRequest({ method: 'GET', docPath: '/users/userA', token: badToken })).status,
          403
        );
        assert.equal(
          (
            await fsRequest({
              method: 'PATCH',
              docPath: '/users/userA',
              body: validAccountState(),
              token: badToken,
            })
          ).status,
          403
        );
        assert.equal(
          (await fsRequest({ method: 'DELETE', docPath: '/users/userA', token: badToken })).status,
          403
        );
        assert.equal(
          (await fsRequest({ method: 'GET', docPath: '/users/userA/projects/proj_1', token: badToken }))
            .status,
          403
        );
        assert.equal(
          (await fsRequest({ method: 'GET', docPath: '/users/userA/projects', token: badToken })).status,
          403
        );
        assert.equal(
          (
            await fsRequest({
              method: 'POST',
              docPath: '/users/userA/projects',
              query: '?documentId=proj_evil',
              body: validProject({ id: 'proj_evil' }),
              token: badToken,
            })
          ).status,
          403
        );
        assert.equal(
          (
            await fsRequest({
              method: 'DELETE',
              docPath: '/users/userA/projects/proj_1',
              token: badToken,
            })
          ).status,
          403
        );
      }
    });

    it('validates /users/{uid} account state fields, quotas, customPaints, overrides, progress, and photos', async () => {
      // Valid full upsert + partial merge
      assert.equal(
        (
          await fsRequest({
            method: 'PATCH',
            docPath: '/users/userA',
            body: validAccountState(),
            token: tokenA,
          })
        ).status,
        200
      );
      assert.equal(
        (
          await fsRequest({
            method: 'PATCH',
            docPath: '/users/userA',
            query: '?updateMask.fieldPaths=inventoryPaintIds&updateMask.fieldPaths=updatedAt',
            body: { inventoryPaintIds: ['p1', 'p3'], updatedAt: '2026-01-02T00:00:00Z' },
            token: tokenA,
          })
        ).status,
        200
      );

      // Empty document, disallowed root keys, and invalid schemaVersion
      const badAccountPayloads = [
        {},
        validAccountState({ admin: true }),
        validAccountState({ projects: [] }),
        validAccountState({ schemaVersion: 0 }),
        validAccountState({ schemaVersion: 1001 }),
        // Preferences
        validAccountState({
          preferences: {
            defaultRangeFilter: 'all',
            allowCompatibleSubstitutions: true,
            allowThirdPartySubstitutions: true,
            preferredThirdPartyBrands: [],
            extraPref: true,
          },
        }),
        validAccountState({
          preferences: {
            defaultRangeFilter: 'invalid_range',
            allowCompatibleSubstitutions: true,
            allowThirdPartySubstitutions: true,
            preferredThirdPartyBrands: [],
          },
        }),
        validAccountState({
          preferences: {
            defaultRangeFilter: 'all',
            allowCompatibleSubstitutions: 'yes',
            allowThirdPartySubstitutions: true,
            preferredThirdPartyBrands: [],
          },
        }),
        validAccountState({
          preferences: {
            defaultRangeFilter: 'all',
            allowCompatibleSubstitutions: true,
            allowThirdPartySubstitutions: true,
            preferredThirdPartyBrands: Array.from({ length: 51 }, (_, i) => `b${i}`),
          },
        }),
        // Custom paints (> 200, extra field head/tail, empty name, > 20 matches, bad matchQuality)
        validAccountState({
          customPaints: Array.from({ length: 201 }, (_, i) => validCustomPaint({ id: `cp_${i}` })),
        }),
        validAccountState({
          customPaints: [validCustomPaint({ extraField: 'nope' })],
        }),
        validAccountState({
          customPaints: [validCustomPaint({ id: 'cp_0' }), validCustomPaint({ id: 'cp_1', extraTail: 1 })],
        }),
        validAccountState({
          customPaints: [validCustomPaint({ name: '' })],
        }),
        validAccountState({
          customPaints: [
            validCustomPaint({
              citadelMatches: Array.from({ length: 21 }, (_, i) => ({
                citadelPaintId: `c_${i}`,
                citadelPaintName: `C ${i}`,
                citadelRange: 'warhammer_colour',
                citadelCategory: 'Base',
                citadelHex: '#000',
                deltaE: 1,
                matchQuality: 'exact',
              })),
            }),
          ],
        }),
        validAccountState({
          customPaints: [
            validCustomPaint({
              citadelMatches: [
                {
                  citadelPaintId: 'c1',
                  citadelPaintName: 'C1',
                  citadelRange: 'warhammer_colour',
                  citadelCategory: 'Base',
                  citadelHex: '#000',
                  deltaE: 1,
                  matchQuality: 'terrible',
                },
              ],
            }),
          ],
        }),
        // customCompatibilityOverrides & modelProgress (> 500 keys, > max list on first or last key)
        validAccountState({
          customCompatibilityOverrides: Object.fromEntries(
            Array.from({ length: 501 }, (_, i) => [`k${i}`, []])
          ),
        }),
        validAccountState({
          customCompatibilityOverrides: {
            a: Array.from({ length: 21 }, (_, i) => `eq_${i}`),
            b: ['ok'],
          },
        }),
        validAccountState({
          customCompatibilityOverrides: {
            a: ['ok'],
            z: Array.from({ length: 21 }, (_, i) => `eq_${i}`),
          },
        }),
        validAccountState({
          modelProgress: Object.fromEntries(Array.from({ length: 501 }, (_, i) => [`m${i}`, []])),
        }),
        validAccountState({
          modelProgress: {
            m1: Array.from({ length: 201 }, (_, i) => `s_${i}`),
            m2: ['ok'],
          },
        }),
        validAccountState({
          modelProgress: {
            m1: ['ok'],
            m2: Array.from({ length: 201 }, (_, i) => `s_${i}`),
          },
        }),
        // uploadedPhotos (> 250, wrong targetType, reference isPrivate:false, bad mime, size 0 / > 5MB, caption > 140, bad storagePath)
        validAccountState({
          uploadedPhotos: Array.from({ length: 251 }, (_, i) => validPhoto({ id: `ph_${i}` })),
        }),
        validAccountState({
          uploadedPhotos: [
            validPhoto({
              targetType: 'project',
              storagePath: 'users/userA/showcase/project/m1/ph_1.jpg',
            }),
          ],
        }),
        validAccountState({
          uploadedPhotos: [
            validPhoto({
              kind: 'reference',
              isPrivate: false,
              storagePath: 'users/userA/private_references/model/m1/ph_1.jpg',
            }),
          ],
        }),
        validAccountState({
          uploadedPhotos: [validPhoto({ mimeType: 'image/gif' })],
        }),
        validAccountState({
          uploadedPhotos: [validPhoto({ sizeBytes: 0 })],
        }),
        validAccountState({
          uploadedPhotos: [validPhoto({ sizeBytes: 5242881 })],
        }),
        validAccountState({
          uploadedPhotos: [validPhoto({ caption: 'x'.repeat(141) })],
        }),
        validAccountState({
          uploadedPhotos: [
            validPhoto({ storagePath: 'users/userB/showcase/model/m1/ph_1.jpg' }),
          ],
        }),
        validAccountState({
          uploadedPhotos: [
            validPhoto({
              kind: 'reference',
              isPrivate: true,
              storagePath: 'users/userA/showcase/model/m1/ph_1.jpg',
            }),
          ],
        }),
        validAccountState({
          uploadedPhotos: [
            validPhoto({
              kind: 'showcase',
              isPrivate: false,
              storagePath: 'users/userA/private_references/model/m1/ph_1.jpg',
            }),
          ],
        }),
        validAccountState({
          uploadedPhotos: [
            validPhoto({ storagePath: 'users/userA/showcase/project/m1/ph_1.jpg' }),
          ],
        }),
        validAccountState({
          uploadedPhotos: [
            validPhoto({ storagePath: 'users/userA/showcase/model/../ph_1.jpg' }),
          ],
        }),
      ];

      for (const [idx, payload] of badAccountPayloads.entries()) {
        const res = await fsRequest({
          method: 'PATCH',
          docPath: '/users/userA',
          body: payload,
          token: tokenA,
        });
        assert.equal(res.status, 403, `Expected 403 for badAccountPayloads[${idx}], got ${res.status}`);
      }
    });

    it('validates /users/{uid}/projects/{projectId} create, immutable createdAt, notes, photos, models, and sub-photos', async () => {
      // Valid create, read, list, update, delete
      assert.equal(
        (
          await fsRequest({
            method: 'POST',
            docPath: '/users/userA/projects',
            query: '?documentId=proj_1',
            body: validProject(),
            token: tokenA,
          })
        ).status,
        200
      );
      assert.equal(
        (await fsRequest({ method: 'GET', docPath: '/users/userA/projects/proj_1', token: tokenA })).status,
        200
      );
      assert.equal(
        (await fsRequest({ method: 'GET', docPath: '/users/userA/projects', token: tokenA })).status,
        200
      );
      assert.equal(
        (
          await fsRequest({
            method: 'PATCH',
            docPath: '/users/userA/projects/proj_1',
            query: '?currentDocument.exists=true',
            body: validProject({ name: 'Renamed Army', updatedAt: '2026-01-02T00:00:00Z' }),
            token: tokenA,
          })
        ).status,
        200
      );

      // Mutating createdAt on update fails
      assert.equal(
        (
          await fsRequest({
            method: 'PATCH',
            docPath: '/users/userA/projects/proj_1',
            query: '?currentDocument.exists=true',
            body: validProject({ createdAt: '2026-02-01T00:00:00Z' }),
            token: tokenA,
          })
        ).status,
        403
      );

      // Delete succeeds for owner
      assert.equal(
        (await fsRequest({ method: 'DELETE', docPath: '/users/userA/projects/proj_1', token: tokenA }))
          .status,
        200
      );

      const badProjects = [
        validProject({ id: 'wrong_id' }),
        validProject({ extraRoot: true }),
        validProject({ name: 'n'.repeat(201) }),
        validProject({ colorIds: Array.from({ length: 101 }, (_, i) => `c${i}`) }),
        validProject({
          notes: Array.from({ length: 51 }, (_, i) => ({
            id: `n_${i}`,
            title: 'T',
            createdAt: '2026-01-01T00:00:00Z',
            updatedAt: '2026-01-01T00:00:00Z',
            components: [],
          })),
        }),
        validProject({
          notes: [
            {
              id: 'n_1',
              title: 'T',
              createdAt: '2026-01-01T00:00:00Z',
              updatedAt: '2026-01-01T00:00:00Z',
              components: Array.from({ length: 101 }, (_, i) => ({
                id: `b_${i}`,
                type: 'text',
                value: 'x',
              })),
            },
          ],
        }),
        validProject({
          notes: [
            {
              id: 'n_1',
              title: 'T',
              createdAt: '2026-01-01T00:00:00Z',
              updatedAt: '2026-01-01T00:00:00Z',
              components: [{ id: 'b_1', type: 'image', value: 'x' }],
            },
          ],
        }),
        validProject({
          notes: [
            {
              id: 'n_1',
              title: 'T',
              createdAt: '2026-01-01T00:00:00Z',
              updatedAt: '2026-01-01T00:00:00Z',
              components: [{ id: 'b_1', type: 'text', value: 'v'.repeat(2001) }],
            },
          ],
        }),
        // Project photos
        validProject({
          photos: Array.from({ length: 19 }, (_, i) =>
            validPhoto({
              id: `p_${i}`,
              targetType: 'project',
              targetId: 'proj_1',
              storagePath: `users/userA/showcase/project/proj_1/p_${i}.jpg`,
            })
          ),
        }),
        validProject({
          photos: [
            validPhoto({
              targetType: 'model',
              targetId: 'proj_1',
              storagePath: 'users/userA/showcase/project/proj_1/ph_1.jpg',
            }),
          ],
        }),
        validProject({
          photos: [
            validPhoto({
              targetType: 'project',
              targetId: 'other_proj',
              storagePath: 'users/userA/showcase/project/proj_1/ph_1.jpg',
            }),
          ],
        }),
        validProject({
          photos: [
            validPhoto({
              id: 'p0',
              targetType: 'project',
              targetId: 'proj_1',
              storagePath: 'users/userA/showcase/project/proj_1/p0.jpg',
            }),
            validPhoto({
              id: 'p1',
              targetType: 'project',
              targetId: 'other_proj',
              storagePath: 'users/userA/showcase/project/proj_1/p1.jpg',
            }),
          ],
        }),
        validProject({
          photos: [
            validPhoto({
              targetType: 'project',
              targetId: 'proj_1',
              kind: 'reference',
              isPrivate: false,
              storagePath: 'users/userA/private_references/project/proj_1/ph_1.jpg',
            }),
          ],
        }),
        validProject({
          photos: [
            validPhoto({
              targetType: 'project',
              targetId: 'proj_1',
              storagePath: 'users/userB/showcase/project/proj_1/ph_1.jpg',
            }),
          ],
        }),
        // Project models
        validProject({
          models: Array.from({ length: 101 }, (_, i) =>
            validProjectModel({ id: `pmod_${i}`, photos: [] })
          ),
        }),
        validProject({ models: [validProjectModel({ quantity: 0 })] }),
        validProject({ models: [validProjectModel({ quantity: 1000 })] }),
        validProject({ models: [validProjectModel({ quantity: 1.5 })] }),
        validProject({ models: [validProjectModel({ notes: 'n'.repeat(5001) })] }),
        validProject({
          models: [
            validProjectModel({
              completedStepIds: Array.from({ length: 201 }, (_, i) => `s_${i}`),
            }),
          ],
        }),
        validProject({
          models: [validProjectModel({ featuredImage: { source: 'invalid_source' } })],
        }),
        validProject({
          models: [
            validProjectModel({
              featuredImage: { source: 'catalog_angle', imageIndex: 0, badKey: 1 },
            }),
          ],
        }),
        validProject({
          models: [
            validProjectModel({
              configurations: Array.from({ length: 31 }, (_, i) => ({
                id: `cfg_${i}`,
                slot: 'W',
                option: 'P',
              })),
            }),
          ],
        }),
        validProject({
          models: [
            validProjectModel({
              configurations: [{ id: 'c1', slot: 'W', option: 'P', extraCfg: 1 }],
            }),
          ],
        }),
        // Project model photos (> 13, wrong targetType, wrong targetId on head[0], head[last] when n==1, and tail[last], bad storagePath)
        validProject({
          models: [
            validProjectModel({
              photos: Array.from({ length: 14 }, (_, i) =>
                validPhoto({
                  id: `mp_${i}`,
                  targetType: 'project_model',
                  targetId: 'pmod_1',
                  storagePath: `users/userA/showcase/project_model/pmod_1/mp_${i}.jpg`,
                })
              ),
            }),
          ],
        }),
        validProject({
          models: [
            validProjectModel({
              photos: [
                validPhoto({
                  targetType: 'model',
                  targetId: 'pmod_1',
                  storagePath: 'users/userA/showcase/project_model/pmod_1/p0.jpg',
                }),
              ],
            }),
          ],
        }),
        validProject({
          models: [
            validProjectModel({
              photos: [
                validPhoto({
                  targetType: 'project_model',
                  targetId: 'wrong_entry',
                  storagePath: 'users/userA/showcase/project_model/pmod_1/p0.jpg',
                }),
              ],
            }),
          ],
        }),
        validProject({
          models: [
            validProjectModel({
              photos: [
                validPhoto({
                  id: 'p0',
                  targetType: 'project_model',
                  targetId: 'pmod_1',
                  storagePath: 'users/userA/showcase/project_model/pmod_1/p0.jpg',
                }),
                validPhoto({
                  id: 'p1',
                  targetType: 'project_model',
                  targetId: 'wrong_entry',
                  storagePath: 'users/userA/showcase/project_model/pmod_1/p1.jpg',
                }),
              ],
            }),
          ],
        }),
        validProject({
          models: [
            validProjectModel({ id: 'pmod_1', photos: [] }),
            validProjectModel({
              id: 'pmod_2',
              photos: [
                validPhoto({
                  id: 'p0',
                  targetType: 'project_model',
                  targetId: 'pmod_2',
                  storagePath: 'users/userA/showcase/project_model/pmod_2/p0.jpg',
                }),
                validPhoto({
                  id: 'p1',
                  targetType: 'project_model',
                  targetId: 'wrong_tail_entry',
                  storagePath: 'users/userA/showcase/project_model/pmod_2/p1.jpg',
                }),
              ],
            }),
          ],
        }),
        validProject({
          models: [
            validProjectModel({
              photos: [
                validPhoto({
                  targetType: 'project_model',
                  targetId: 'pmod_1',
                  storagePath: 'users/userA/showcase/project/pmod_1/p0.jpg',
                }),
              ],
            }),
          ],
        }),
      ];

      for (const [idx, proj] of badProjects.entries()) {
        const res = await fsRequest({
          method: 'POST',
          docPath: '/users/userA/projects',
          query: '?documentId=proj_1',
          body: proj,
          token: tokenA,
        });
        assert.equal(res.status, 403, `Expected 403 for badProjects[${idx}], got ${res.status}`);
      }
    });

    it('passes CEL expression budget for max-count UserAccountState and UserProject documents under 1 MiB', async () => {
      const maxAccount = {
        schemaVersion: 2,
        updatedAt: '2026-01-01T00:00:00Z',
        inventoryPaintIds: Array.from({ length: 1000 }, (_, i) => `ip${i}`),
        wishlistPaintIds: Array.from({ length: 500 }, (_, i) => `wp${i}`),
        inventoryModelIds: Array.from({ length: 2000 }, (_, i) => `im${i}`),
        wishlistModelIds: Array.from({ length: 1000 }, (_, i) => `wm${i}`),
        customPaints: Array.from({ length: 200 }, (_, i) =>
          validCustomPaint({
            id: `cp${i}`,
            name: `Paint ${i}`,
            citadelMatches: [
              {
                citadelPaintId: 'c1',
                citadelPaintName: 'C',
                citadelRange: 'warhammer_colour',
                citadelCategory: 'Base',
                citadelHex: '#000',
                deltaE: 1,
                matchQuality: 'exact',
              },
            ],
          })
        ),
        customCompatibilityOverrides: Object.fromEntries(
          Array.from({ length: 500 }, (_, i) => [`ov${i}`, ['x']])
        ),
        modelProgress: Object.fromEntries(Array.from({ length: 500 }, (_, i) => [`mp${i}`, ['s1']])),
        uploadedPhotos: Array.from({ length: 250 }, (_, i) =>
          validPhoto({
            id: `ph${i}`,
            targetType: 'model',
            targetId: 'm1',
            caption: '',
            storagePath: `users/userA/showcase/model/m1/ph${i}.jpg`,
          })
        ),
        preferences: {
          defaultRangeFilter: 'all',
          allowCompatibleSubstitutions: true,
          allowThirdPartySubstitutions: true,
          preferredThirdPartyBrands: Array.from({ length: 50 }, (_, i) => `Brand ${i}`),
        },
      };

      const accountRes = await fsRequest({
        method: 'PATCH',
        docPath: '/users/userA',
        body: maxAccount,
        token: tokenA,
      });
      assert.equal(accountRes.status, 200, `Max UserAccountState failed: ${JSON.stringify(accountRes.body)}`);

      const maxProject = {
        id: 'proj_max',
        name: 'Max Stress Project',
        thumbnailUrl: null,
        localThumbnailPath: null,
        coverPhotoId: null,
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
        colorIds: Array.from({ length: 100 }, (_, i) => `c${i}`),
        notes: Array.from({ length: 50 }, (_, i) => ({
          id: `n${i}`,
          title: `N${i}`,
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-01T00:00:00Z',
          components: Array.from({ length: 20 }, (_, j) => ({
            id: `b${j}`,
            type: 'checkbox',
            value: 'Step',
            checked: false,
          })),
        })),
        photos: Array.from({ length: 18 }, (_, i) =>
          validPhoto({
            id: `pp${i}`,
            targetType: 'project',
            targetId: 'proj_max',
            caption: '',
            storagePath: `users/userA/showcase/project/proj_max/pp${i}.jpg`,
          })
        ),
        models: Array.from({ length: 100 }, (_, i) => ({
          id: `pm_${i}`,
          recipeId: `r${i}`,
          quantity: 1,
          notes: '',
          completedStepIds: Array.from({ length: 20 }, (_, s) => `s${s}`),
          photos: Array.from({ length: 13 }, (_, p) =>
            validPhoto({
              id: `mp_${i}_${p}`,
              targetType: 'project_model',
              targetId: `pm_${i}`,
              caption: '',
              storagePath: `users/userA/showcase/project_model/pm_${i}/mp_${i}_${p}.jpg`,
            })
          ),
          configurations: Array.from({ length: 30 }, (_, c) => ({
            id: `cfg_${c}`,
            slot: 'W',
            option: 'O',
          })),
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-01T00:00:00Z',
        })),
      };

      const projRes = await fsRequest({
        method: 'POST',
        docPath: '/users/userA/projects',
        query: '?documentId=proj_max',
        body: maxProject,
        token: tokenA,
      });
      assert.equal(projRes.status, 200, `Max UserProject failed: ${JSON.stringify(projRes.body)}`);
    });
  }
);
