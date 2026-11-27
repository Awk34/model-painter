import {
  PKCE_STATE_KEY,
  PKCE_TOKEN_CACHE_KEY,
  PKCE_VERIFIER_KEY,
  clearPkceTransaction,
  clearWarhammerTokenCache,
  readCachedWarhammerBearer,
  readCachedWarhammerTokenEntry,
  readPkceTransaction,
  savePkceTransaction,
  writeWarhammerTokenCache,
} from './warhammer-pkce-storage.util';

describe('warhammer-pkce-storage.util', () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
  });

  afterEach(() => {
    sessionStorage.clear();
    localStorage.clear();
  });

  it('saves, reads, and clears PKCE transactions in sessionStorage while purging legacy localStorage keys', () => {
    localStorage.setItem(PKCE_VERIFIER_KEY, 'legacy-verifier');
    localStorage.setItem(PKCE_STATE_KEY, 'legacy-state');

    savePkceTransaction('verifier-123', 'state-456');

    expect(sessionStorage.getItem(PKCE_VERIFIER_KEY)).toBe('verifier-123');
    expect(sessionStorage.getItem(PKCE_STATE_KEY)).toBe('state-456');
    expect(localStorage.getItem(PKCE_VERIFIER_KEY)).toBeNull();
    expect(localStorage.getItem(PKCE_STATE_KEY)).toBeNull();
    expect(readPkceTransaction()).toEqual({
      codeVerifier: 'verifier-123',
      state: 'state-456',
    });

    localStorage.setItem(PKCE_VERIFIER_KEY, 'stale-v');
    clearPkceTransaction();
    expect(readPkceTransaction()).toEqual({ codeVerifier: '', state: '' });
    expect(localStorage.getItem(PKCE_VERIFIER_KEY)).toBeNull();
  });

  it('writes, reads, and clears token cache entries and trims bearer tokens', () => {
    localStorage.setItem(PKCE_TOKEN_CACHE_KEY, JSON.stringify({ code: 'old', bearer: 'old' }));

    writeWarhammerTokenCache('auth-code-1', '  bearer-xyz  ');
    expect(localStorage.getItem(PKCE_TOKEN_CACHE_KEY)).toBeNull();
    expect(readCachedWarhammerTokenEntry()).toEqual({
      code: 'auth-code-1',
      bearer: '  bearer-xyz  ',
    });
    expect(readCachedWarhammerBearer()).toBe('bearer-xyz');

    writeWarhammerTokenCache('auth-code-2', '   ');
    expect(readCachedWarhammerBearer()).toBeNull();

    clearWarhammerTokenCache();
    expect(readCachedWarhammerTokenEntry()).toBeNull();
    expect(readCachedWarhammerBearer()).toBeNull();
  });

  it('handles malformed, non-object, array, and non-string JSON in token cache safely', () => {
    const warnSpy = spyOn(console, 'warn');

    sessionStorage.setItem(PKCE_TOKEN_CACHE_KEY, '{bad-json');
    expect(readCachedWarhammerTokenEntry()).toBeNull();
    expect(warnSpy).toHaveBeenCalledTimes(1);

    sessionStorage.setItem(PKCE_TOKEN_CACHE_KEY, JSON.stringify(['not', 'an', 'object']));
    expect(readCachedWarhammerTokenEntry()).toBeNull();

    sessionStorage.setItem(PKCE_TOKEN_CACHE_KEY, JSON.stringify('string-value'));
    expect(readCachedWarhammerTokenEntry()).toBeNull();

    sessionStorage.setItem(PKCE_TOKEN_CACHE_KEY, JSON.stringify({ code: 123, bearer: { a: 1 } }));
    expect(readCachedWarhammerTokenEntry()).toEqual({
      code: undefined,
      bearer: undefined,
    });
    expect(readCachedWarhammerBearer()).toBeNull();
  });

  it('remains resilient when sessionStorage or localStorage throws SecurityError', () => {
    const securityErr = new DOMException('Denied', 'SecurityError');
    spyOn(Storage.prototype, 'setItem').and.throwError(securityErr);
    spyOn(Storage.prototype, 'getItem').and.throwError(securityErr);
    spyOn(Storage.prototype, 'removeItem').and.throwError(securityErr);

    expect(() => savePkceTransaction('v', 's')).not.toThrow();
    expect(() => writeWarhammerTokenCache('c', 'b')).not.toThrow();
    expect(readPkceTransaction()).toEqual({ codeVerifier: '', state: '' });
    expect(readCachedWarhammerTokenEntry()).toBeNull();
    expect(readCachedWarhammerBearer()).toBeNull();
    expect(() => clearPkceTransaction()).not.toThrow();
    expect(() => clearWarhammerTokenCache()).not.toThrow();
  });
});
