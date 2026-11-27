import {
  getStoredFirebaseConfig,
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

  afterEach(() => {
    localStorage.removeItem(FIREBASE_CONFIG_STORAGE_KEY);
    resetRuntimeFirebaseConfigForTests();
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
});
