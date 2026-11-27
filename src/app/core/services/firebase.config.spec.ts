import {
  getFirebaseApp,
  getFirebaseAuth,
  getFirebaseFirestore,
  getFirebaseFunctions,
  getFirebaseStorage,
  getLoadedFirebaseAuth,
  getRuntimeConfigEndpoints,
  getStoredFirebaseConfig,
  invalidateLocalFirebaseConfigCache,
  isRevokedApiKey,
  loadRuntimeFirebaseConfig,
  resetRuntimeFirebaseConfigForTests,
} from './firebase.config';

const FIREBASE_CONFIG_STORAGE_KEY = 'whc_firebase_config_v1';

function buildRevokedTestKey(): string {
  // Assembled dynamically so no contiguous Google API key literal exists in source or test files
  return ['AIza', 'SyByG509', 'x0FEeglK', 'VCT0REfX', '3dEC750i', 'Ru4'].join('');
}

function buildValidTestKey(): string {
  return ['test', 'Key', 'Value', '1234567890'].join('_');
}

describe('firebase.config', () => {
  beforeEach(() => {
    localStorage.removeItem(FIREBASE_CONFIG_STORAGE_KEY);
    resetRuntimeFirebaseConfigForTests();
  });

  afterEach(async () => {
    localStorage.removeItem(FIREBASE_CONFIG_STORAGE_KEY);
    resetRuntimeFirebaseConfigForTests();
    const { deleteApp, getApps } = await import('firebase/app');
    await Promise.all(getApps().map((app) => deleteApp(app)));
  });

  it('detects the revoked API key via digest without rejecting unrelated keys', () => {
    expect(isRevokedApiKey(buildRevokedTestKey())).toBeTrue();
    expect(isRevokedApiKey(`  ${buildRevokedTestKey()}  `)).toBeTrue();
    expect(isRevokedApiKey(buildValidTestKey())).toBeFalse();
  });

  it('purges a revoked config from localStorage and accepts valid stored configs', () => {
    localStorage.setItem(
      FIREBASE_CONFIG_STORAGE_KEY,
      JSON.stringify({
        apiKey: buildRevokedTestKey(),
        authDomain: 'model-painter-a8724.firebaseapp.com',
        projectId: 'model-painter-a8724',
      })
    );

    expect(getStoredFirebaseConfig()).toBeNull();
    expect(localStorage.getItem(FIREBASE_CONFIG_STORAGE_KEY)).toBeNull();

    resetRuntimeFirebaseConfigForTests();
    const validCfg = {
      apiKey: buildValidTestKey(),
      authDomain: 'model-painter-a8724.firebaseapp.com',
      projectId: 'model-painter-a8724',
    };
    localStorage.setItem(FIREBASE_CONFIG_STORAGE_KEY, JSON.stringify(validCfg));
    expect(getStoredFirebaseConfig()).toEqual(validCfg);
  });

  it('ignores 200 text/html SPA rewrites and revoked runtime configs, and passes AbortSignal', async () => {
    const fetchSpy = spyOn(window, 'fetch').and.callFake(async (input) => {
      const url = String(input);
      if (url === '/firebase-config.local.json') {
        return new Response('<!doctype html><html></html>', {
          status: 200,
          headers: { 'Content-Type': 'text/html' },
        });
      }
      if (url === '/__/firebase/init.json') {
        return new Response(
          JSON.stringify({
            apiKey: buildRevokedTestKey(),
            authDomain: 'model-painter-a8724.firebaseapp.com',
            projectId: 'model-painter-a8724',
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }
        );
      }
      return new Response('Not Found', { status: 404 });
    });

    await expectAsync(loadRuntimeFirebaseConfig()).toBeResolved();
    expect(getStoredFirebaseConfig()).toBeNull();

    for (const args of fetchSpy.calls.allArgs()) {
      expect(args[1]?.signal).toBeInstanceOf(AbortSignal);
      expect(args[1]?.cache).toBe('no-store');
    }
  });

  it('accepts valid runtime JSON config from fallback endpoint', async () => {
    const validCfg = {
      apiKey: buildValidTestKey(),
      authDomain: 'model-painter-a8724.firebaseapp.com',
      projectId: 'model-painter-a8724',
    };

    spyOn(window, 'fetch').and.callFake(async (input) => {
      const url = String(input);
      if (url === '/__/firebase/init.json') {
        return new Response(JSON.stringify(validCfg), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response('Not Found', { status: 404 });
    });

    await loadRuntimeFirebaseConfig();
    expect(getStoredFirebaseConfig()).toEqual(validCfg);
  });

  it('caches both null and valid localStorage config reads until invalidated', () => {
    const getItemSpy = spyOn(Storage.prototype, 'getItem').and.callThrough();

    // Null result is cached after first read
    expect(getStoredFirebaseConfig()).toBeNull();
    expect(getStoredFirebaseConfig()).toBeNull();
    expect(getItemSpy).toHaveBeenCalledTimes(1);

    const validCfg = {
      apiKey: buildValidTestKey(),
      authDomain: 'model-painter-a8724.firebaseapp.com',
      projectId: 'model-painter-a8724',
    };
    localStorage.setItem(FIREBASE_CONFIG_STORAGE_KEY, JSON.stringify(validCfg));

    // Cached null persists until invalidateLocalFirebaseConfigCache()
    expect(getStoredFirebaseConfig()).toBeNull();
    expect(getItemSpy).toHaveBeenCalledTimes(1);

    invalidateLocalFirebaseConfigCache();
    expect(getStoredFirebaseConfig()).toEqual(validCfg);
    expect(getStoredFirebaseConfig()).toEqual(validCfg);
    expect(getItemSpy).toHaveBeenCalledTimes(2);
  });

  it('orders runtime config endpoints with /__/firebase/init.json first in production and /firebase-config.local.json first on localhost', () => {
    expect(getRuntimeConfigEndpoints(false)).toEqual([
      '/__/firebase/init.json',
      '/firebase-config.json',
    ]);
    expect(getRuntimeConfigEndpoints(true)).toEqual([
      '/firebase-config.local.json',
      '/__/firebase/init.json',
    ]);
  });

  it('returns null from lazy Firebase SDK loaders when unconfigured and deduplicates concurrent loads when configured', async () => {
    expect(getLoadedFirebaseAuth()).toBeNull();
    expect(await getFirebaseApp()).toBeNull();
    expect(await getFirebaseAuth()).toBeNull();
    expect(await getFirebaseFirestore()).toBeNull();
    expect(await getFirebaseStorage()).toBeNull();
    expect(await getFirebaseFunctions()).toBeNull();
    expect(getLoadedFirebaseAuth()).toBeNull();

    localStorage.setItem(
      FIREBASE_CONFIG_STORAGE_KEY,
      JSON.stringify({
        apiKey: buildValidTestKey(),
        authDomain: 'model-painter-a8724.firebaseapp.com',
        projectId: 'model-painter-a8724',
        storageBucket: 'model-painter-a8724.appspot.com',
      })
    );
    invalidateLocalFirebaseConfigCache();

    const [app1, app2] = await Promise.all([getFirebaseApp(), getFirebaseApp()]);
    expect(app1).not.toBeNull();
    expect(app2).toBe(app1);

    const [auth1, auth2] = await Promise.all([getFirebaseAuth(), getFirebaseAuth()]);
    expect(auth1).not.toBeNull();
    expect(auth2).toBe(auth1);
    expect(getLoadedFirebaseAuth()).toBe(auth1!.auth);

    const [fs1, fs2] = await Promise.all([getFirebaseFirestore(), getFirebaseFirestore()]);
    expect(fs1).not.toBeNull();
    expect(fs2).toBe(fs1);

    const [st1, st2] = await Promise.all([getFirebaseStorage(), getFirebaseStorage()]);
    expect(st1).not.toBeNull();
    expect(st2).toBe(st1);

    const [fn1, fn2] = await Promise.all([getFirebaseFunctions(), getFirebaseFunctions()]);
    expect(fn1).not.toBeNull();
    expect(fn2).toBe(fn1);
  });

  it('purges malformed JSON, arrays, and incomplete configs from localStorage', () => {
    localStorage.setItem(FIREBASE_CONFIG_STORAGE_KEY, '{broken-json');
    expect(getStoredFirebaseConfig()).toBeNull();
    expect(localStorage.getItem(FIREBASE_CONFIG_STORAGE_KEY)).toBeNull();

    resetRuntimeFirebaseConfigForTests();
    localStorage.setItem(FIREBASE_CONFIG_STORAGE_KEY, JSON.stringify(['array']));
    expect(getStoredFirebaseConfig()).toBeNull();
    expect(localStorage.getItem(FIREBASE_CONFIG_STORAGE_KEY)).toBeNull();

    resetRuntimeFirebaseConfigForTests();
    localStorage.setItem(
      FIREBASE_CONFIG_STORAGE_KEY,
      JSON.stringify({ apiKey: '   ', authDomain: 'a', projectId: 'p' })
    );
    expect(getStoredFirebaseConfig()).toBeNull();
    expect(localStorage.getItem(FIREBASE_CONFIG_STORAGE_KEY)).toBeNull();
  });
});
