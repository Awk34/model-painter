import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FirebaseFunctionsHandle } from './firebase.config';
import { CatalogService } from './catalog.service';
import { UserStateService } from './user-state.service';
import { WarhammerImportService } from './warhammer-import.service';
import {
  PKCE_STATE_KEY,
  PKCE_TOKEN_CACHE_KEY,
  PKCE_VERIFIER_KEY,
} from '../utils/warhammer-pkce-storage.util';

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('WarhammerImportService', () => {
  let service: WarhammerImportService;
  let userStateSpy: jasmine.SpyObj<UserStateService>;
  let catalogSpy: jasmine.SpyObj<CatalogService>;
  let fetchSpy: jasmine.Spy<typeof window.fetch>;

  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();

    userStateSpy = jasmine.createSpyObj<UserStateService>('UserStateService', [
      'importAccountPayload',
    ]);
    catalogSpy = jasmine.createSpyObj<CatalogService>('CatalogService', ['clearEntityCaches'], {
      paints: signal([]),
      thirdPartyPaints: signal([]),
    });
    catalogSpy.clearEntityCaches.and.resolveTo();

    TestBed.configureTestingModule({
      providers: [
        WarhammerImportService,
        { provide: UserStateService, useValue: userStateSpy },
        { provide: CatalogService, useValue: catalogSpy },
      ],
    });

    service = TestBed.inject(WarhammerImportService);
    fetchSpy = spyOn(window, 'fetch');
  });

  afterEach(() => {
    sessionStorage.clear();
    localStorage.clear();
  });

  it('stores PKCE code_verifier and state in sessionStorage only and clears legacy localStorage keys', async () => {
    localStorage.setItem(PKCE_VERIFIER_KEY, 'legacy-verifier');
    localStorage.setItem(PKCE_STATE_KEY, 'legacy-state');

    const result = await service.generateMyWarhammerLoginUrl();
    const parsed = new URL(result.authorizeUrl);

    expect(parsed.origin).toBe('https://login.mywarhammer.com');
    expect(parsed.searchParams.get('code_challenge_method')).toBe('S256');
    expect(parsed.searchParams.get('state')).toBe(result.state);
    expect(sessionStorage.getItem(PKCE_VERIFIER_KEY)).toBe(result.codeVerifier);
    expect(sessionStorage.getItem(PKCE_STATE_KEY)).toBe(result.state);
    expect(localStorage.getItem(PKCE_VERIFIER_KEY)).toBeNull();
    expect(localStorage.getItem(PKCE_STATE_KEY)).toBeNull();
  });

  it('rejects missing code, bare code without state, missing state, mismatched state, and missing sessionStorage transaction, while clearing PKCE keys', async () => {
    await expectAsync(
      service.exchangeCallbackAndImport('citadel-colour://login.mywarhammer.com/callback')
    ).toBeRejectedWithError(/valid \?code=/);

    await expectAsync(
      service.exchangeCallbackAndImport('raw_auth_code_without_url_or_state')
    ).toBeRejectedWithError(/valid \?code=/);

    const { state } = await service.generateMyWarhammerLoginUrl();
    await expectAsync(
      service.exchangeCallbackAndImport(
        'citadel-colour://login.mywarhammer.com/android/com.gamesworkshop.citadelpaint/callback?code=code_123'
      )
    ).toBeRejectedWithError(/Missing \?state=/);
    expect(sessionStorage.getItem(PKCE_VERIFIER_KEY)).toBeNull();
    expect(sessionStorage.getItem(PKCE_STATE_KEY)).toBeNull();

    await service.generateMyWarhammerLoginUrl();
    await expectAsync(
      service.exchangeCallbackAndImport(
        `citadel-colour://login.mywarhammer.com/android/com.gamesworkshop.citadelpaint/callback?code=code_123&state=${state}-tampered`
      )
    ).toBeRejectedWithError(/state mismatch/i);
    expect(sessionStorage.getItem(PKCE_VERIFIER_KEY)).toBeNull();
    expect(sessionStorage.getItem(PKCE_STATE_KEY)).toBeNull();

    // Even if legacy localStorage contains PKCE keys, sessionStorage is required
    localStorage.setItem(PKCE_VERIFIER_KEY, 'legacy-verifier');
    localStorage.setItem(PKCE_STATE_KEY, 'legacy-state');
    await expectAsync(
      service.exchangeCallbackAndImport(
        'citadel-colour://login.mywarhammer.com/android/com.gamesworkshop.citadelpaint/callback?code=code_123&state=legacy-state'
      )
    ).toBeRejectedWithError(/Missing PKCE session state/);
    expect(localStorage.getItem(PKCE_VERIFIER_KEY)).toBeNull();
    expect(localStorage.getItem(PKCE_STATE_KEY)).toBeNull();
  });

  it('does not reuse a stale cached bearer token when a new authorization code fails exchange', async () => {
    sessionStorage.setItem(
      PKCE_TOKEN_CACHE_KEY,
      JSON.stringify({ code: 'old-code', bearer: 'stale-bearer-token' })
    );
    const { state } = await service.generateMyWarhammerLoginUrl();

    spyOn(
      service as unknown as { isLocalDevHost: () => boolean },
      'isLocalDevHost'
    ).and.returnValue(true);
    spyOn(
      service as unknown as {
        getFirebaseFunctionsSafe: () => Promise<FirebaseFunctionsHandle | null>;
      },
      'getFirebaseFunctionsSafe'
    ).and.resolveTo(null);

    fetchSpy.and.resolveTo(
      new Response('{"error":"invalid_grant"}', {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    await expectAsync(
      service.exchangeCallbackAndImport(
        `citadel-colour://login.mywarhammer.com/android/com.gamesworkshop.citadelpaint/callback?code=new-code&state=${state}`
      )
    ).toBeRejectedWithError(/401/);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.calls.mostRecent().args[0]).toBe('/gw-auth-api/oauth/token');
    expect(userStateSpy.importAccountPayload).not.toHaveBeenCalled();
  });

  it('caches token in sessionStorage only, encodes safe project IDs, skips unsafe project IDs, passes AbortSignal, and clears PKCE keys', async () => {
    const { state } = await service.generateMyWarhammerLoginUrl();

    spyOn(
      service as unknown as { isLocalDevHost: () => boolean },
      'isLocalDevHost'
    ).and.returnValue(true);
    spyOn(
      service as unknown as {
        getFirebaseFunctionsSafe: () => Promise<FirebaseFunctionsHandle | null>;
      },
      'getFirebaseFunctionsSafe'
    ).and.resolveTo(null);

    fetchSpy.and.callFake(async (input) => {
      const url = String(input);
      if (url === '/gw-auth-api/oauth/token') {
        return jsonResponse({ access_token: 'fresh-bearer-123' });
      }
      if (url === '/gw-paint-api/inventory/paints?locale=en') {
        return jsonResponse([{ id: 'paint-1' }]);
      }
      if (url === '/gw-paint-api/wishlist/paints?locale=en') {
        return jsonResponse([{ id: 'paint-2' }]);
      }
      if (url === '/gw-paint-api/projects?locale=en') {
        return jsonResponse([{ id: 'proj_safe-1', name: 'Safe' }, { id: '../evil', name: 'Unsafe' }]);
      }
      if (url === '/gw-paint-api/projects/proj_safe-1?locale=en') {
        return jsonResponse({ id: 'proj_safe-1', name: 'Safe Detailed' });
      }
      return new Response('Not Found', { status: 404 });
    });

    await service.exchangeCallbackAndImport(
      `citadel-colour://login.mywarhammer.com/android/com.gamesworkshop.citadelpaint/callback?code=valid_code&state=${state}`,
      'replace'
    );

    expect(sessionStorage.getItem(PKCE_VERIFIER_KEY)).toBeNull();
    expect(sessionStorage.getItem(PKCE_STATE_KEY)).toBeNull();
    expect(localStorage.getItem(PKCE_TOKEN_CACHE_KEY)).toBeNull();
    expect(sessionStorage.getItem(PKCE_TOKEN_CACHE_KEY)).toContain('fresh-bearer-123');

    const requestedUrls = fetchSpy.calls.allArgs().map((args) => String(args[0]));
    expect(requestedUrls).toContain('/gw-paint-api/projects/proj_safe-1?locale=en');
    expect(requestedUrls.some((u) => u.includes('evil'))).toBeFalse();

    for (const callArgs of fetchSpy.calls.allArgs()) {
      expect(callArgs[1]?.signal).toBeInstanceOf(AbortSignal);
    }

    expect(userStateSpy.importAccountPayload).toHaveBeenCalledWith(
      jasmine.objectContaining({
        inventoryPaintIds: ['paint-1'],
        wishlistPaintIds: ['paint-2'],
        projects: [
          { id: 'proj_safe-1', name: 'Safe Detailed' },
          { id: '../evil', name: 'Unsafe' },
        ],
      }),
      'replace'
    );
    expect(catalogSpy.clearEntityCaches).toHaveBeenCalledTimes(1);
  });

  it('surfaces Cloud Function errors in production instead of falling back to /gw-auth-api', async () => {
    const { state } = await service.generateMyWarhammerLoginUrl();
    const fakeHandles = { functions: {} } as unknown as FirebaseFunctionsHandle;

    spyOn(
      service as unknown as { isLocalDevHost: () => boolean },
      'isLocalDevHost'
    ).and.returnValue(false);
    spyOn(
      service as unknown as {
        getFirebaseFunctionsSafe: () => Promise<FirebaseFunctionsHandle | null>;
      },
      'getFirebaseFunctionsSafe'
    ).and.resolveTo(fakeHandles);
    spyOn(
      service as unknown as { callImportCloudFunction: () => Promise<Record<string, unknown>> },
      'callImportCloudFunction'
    ).and.rejectWith(Object.assign(new Error('App Check failed'), { code: 'functions/unauthenticated' }));

    await expectAsync(
      service.exchangeCallbackAndImport(
        `citadel-colour://login.mywarhammer.com/android/com.gamesworkshop.citadelpaint/callback?code=code_123&state=${state}`
      )
    ).toBeRejectedWithError(/App Check failed/);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(PKCE_VERIFIER_KEY)).toBeNull();
  });

  it('rejects on production when Firebase handles are not configured without hitting /gw-auth-api', async () => {
    const { state } = await service.generateMyWarhammerLoginUrl();

    spyOn(
      service as unknown as { isLocalDevHost: () => boolean },
      'isLocalDevHost'
    ).and.returnValue(false);
    spyOn(
      service as unknown as {
        getFirebaseFunctionsSafe: () => Promise<FirebaseFunctionsHandle | null>;
      },
      'getFirebaseFunctionsSafe'
    ).and.resolveTo(null);

    await expectAsync(
      service.exchangeCallbackAndImport(
        `citadel-colour://login.mywarhammer.com/android/com.gamesworkshop.citadelpaint/callback?code=code_123&state=${state}`
      )
    ).toBeRejectedWithError(/Cloud Function is not configured/);

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('falls back to /gw-auth-api on localhost only for Cloud Function unavailable errors, not auth errors', async () => {
    const fakeHandles = { functions: {} } as unknown as FirebaseFunctionsHandle;
    spyOn(
      service as unknown as { isLocalDevHost: () => boolean },
      'isLocalDevHost'
    ).and.returnValue(true);
    spyOn(
      service as unknown as {
        getFirebaseFunctionsSafe: () => Promise<FirebaseFunctionsHandle | null>;
      },
      'getFirebaseFunctionsSafe'
    ).and.resolveTo(fakeHandles);

    const callSpy = spyOn(
      service as unknown as { callImportCloudFunction: () => Promise<Record<string, unknown>> },
      'callImportCloudFunction'
    );

    // 1. functions/unauthenticated should NOT fall back
    const tx1 = await service.generateMyWarhammerLoginUrl();
    callSpy.and.rejectWith(
      Object.assign(new Error('Sign in required'), { code: 'functions/unauthenticated' })
    );
    await expectAsync(
      service.exchangeCallbackAndImport(
        `citadel-colour://login.mywarhammer.com/android/com.gamesworkshop.citadelpaint/callback?code=code_1&state=${tx1.state}`
      )
    ).toBeRejectedWithError(/Sign in required/);
    expect(fetchSpy).not.toHaveBeenCalled();

    // 2. functions/unavailable on localhost SHOULD fall back to /gw-auth-api
    const tx2 = await service.generateMyWarhammerLoginUrl();
    callSpy.and.rejectWith(
      Object.assign(new Error('Emulator offline'), { code: 'functions/unavailable' })
    );
    fetchSpy.and.callFake(async (input) => {
      const url = String(input);
      if (url === '/gw-auth-api/oauth/token') {
        return jsonResponse({ access_token: 'local-fallback-token' });
      }
      if (url.includes('/projects?locale=en')) {
        return jsonResponse([]);
      }
      return jsonResponse([]);
    });

    await service.exchangeCallbackAndImport(
      `citadel-colour://login.mywarhammer.com/android/com.gamesworkshop.citadelpaint/callback?code=code_2&state=${tx2.state}`
    );
    expect(fetchSpy).toHaveBeenCalled();
    expect(userStateSpy.importAccountPayload).toHaveBeenCalled();
  });

  it('handles ?error=... callbacks, proxy 404/HTML or missing token errors, same-code cache hits, and getCachedBearerToken()', async () => {
    await service.generateMyWarhammerLoginUrl();
    await expectAsync(
      service.exchangeCallbackAndImport(
        'citadel-colour://login.mywarhammer.com/callback?error=access_denied&error_description=User%20cancelled'
      )
    ).toBeRejectedWithError(/User cancelled/);
    expect(sessionStorage.getItem(PKCE_VERIFIER_KEY)).toBeNull();

    // 404/HTML proxy error
    const tx1 = await service.generateMyWarhammerLoginUrl();
    spyOn(
      service as unknown as { isLocalDevHost: () => boolean },
      'isLocalDevHost'
    ).and.returnValue(true);
    spyOn(
      service as unknown as {
        getFirebaseFunctionsSafe: () => Promise<FirebaseFunctionsHandle | null>;
      },
      'getFirebaseFunctionsSafe'
    ).and.resolveTo(null);

    fetchSpy.and.resolveTo(
      new Response('<html>Not Found</html>', {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      })
    );
    await expectAsync(
      service.exchangeCallbackAndImport(
        `citadel-colour://login.mywarhammer.com/callback?code=c1&state=${tx1.state}`
      )
    ).toBeRejectedWithError(/Local proxy \(\/gw-auth-api\) is not active/);

    // Missing access_token/id_token
    const tx2 = await service.generateMyWarhammerLoginUrl();
    fetchSpy.and.resolveTo(jsonResponse({ token_type: 'Bearer' }));
    await expectAsync(
      service.exchangeCallbackAndImport(
        `citadel-colour://login.mywarhammer.com/callback?code=c2&state=${tx2.state}`
      )
    ).toBeRejectedWithError(/No access_token returned/);

    // Same-code cache hit skips /gw-auth-api/oauth/token and exposes getCachedBearerToken()
    sessionStorage.setItem(
      PKCE_TOKEN_CACHE_KEY,
      JSON.stringify({ code: 'cached_code', bearer: 'cached_bearer_tok' })
    );
    expect(service.getCachedBearerToken()).toBe('cached_bearer_tok');

    const tx3 = await service.generateMyWarhammerLoginUrl();
    fetchSpy.calls.reset();
    fetchSpy.and.callFake(async () => jsonResponse([]));
    await service.exchangeCallbackAndImport(
      `citadel-colour://login.mywarhammer.com/callback?code=cached_code&state=${tx3.state}`
    );
    expect(
      fetchSpy.calls.allArgs().some((a) => String(a[0]) === '/gw-auth-api/oauth/token')
    ).toBeFalse();
  });

  it('imports JSON and CSV files via importFromFile() with ID/name lookup and wishlist routing', async () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        WarhammerImportService,
        { provide: UserStateService, useValue: userStateSpy },
        {
          provide: CatalogService,
          useValue: {
            clearEntityCaches: jasmine.createSpy('clearEntityCaches').and.resolveTo(),
            paints: signal([
              { id: 'cit-red', name: 'Mephiston Red', range: 'warhammer_colour', category: 'Base' },
            ]),
            thirdPartyPaints: signal([
              {
                id: 'tp-val',
                brand: 'Vallejo',
                range: 'Model Color',
                name: 'Flat Red',
                category: 'Acrylic',
                hex: '#991111',
                citadelMatches: [],
              },
            ]),
          },
        },
      ],
    });
    const svc = TestBed.inject(WarhammerImportService);

    const jsonFile = new File(
      [JSON.stringify({ inventoryPaintIds: ['cit-red'], projects: [] })],
      'backup.json',
      { type: 'application/json' }
    );
    await svc.importFromFile(jsonFile, 'replace');
    expect(userStateSpy.importAccountPayload).toHaveBeenCalledWith(
      { inventoryPaintIds: ['cit-red'], projects: [] },
      'replace'
    );

    const csvFile = new File(
      [
        'paint_id,paint_name,list_type\n' +
          'p-by-id,Ignored,inventory\n' +
          ',Mephiston Red,wishlist\n' +
          ',Flat Red,inventory\n' +
          ',Unknown Paint,inventory\n',
      ],
      'paints.csv',
      { type: 'text/csv' }
    );
    await svc.importFromFile(csvFile, 'merge');
    expect(userStateSpy.importAccountPayload).toHaveBeenCalledWith(
      {
        inventoryPaintIds: ['p-by-id', 'tp-val'],
        wishlistPaintIds: ['cit-red'],
      },
      'merge'
    );

    const emptyCsv = new File(['paint_id,paint_name,list_type\n'], 'empty.csv', {
      type: 'text/csv',
    });
    await expectAsync(svc.importFromFile(emptyCsv)).toBeRejectedWithError(/empty or missing rows/i);
  });
});
