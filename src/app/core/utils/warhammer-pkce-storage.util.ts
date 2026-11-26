export const PKCE_VERIFIER_KEY = 'whc_pkce_code_verifier';
export const PKCE_STATE_KEY = 'whc_pkce_state';
export const PKCE_TOKEN_CACHE_KEY = 'whc_pkce_token_cache';

export interface WarhammerTokenCacheEntry {
  code?: string;
  bearer?: string;
}

function getSessionStorage(): Storage | null {
  try {
    return typeof sessionStorage !== 'undefined' ? sessionStorage : null;
  } catch {
    return null;
  }
}

function getLocalStorage(): Storage | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

function removeLegacyLocalStorageKeys(keys: readonly string[]): void {
  const ls = getLocalStorage();
  if (!ls) {
    return;
  }
  for (const key of keys) {
    try {
      ls.removeItem(key);
    } catch {
      // Ignore storage access errors
    }
  }
}

function setSessionItem(key: string, value: string): void {
  const ss = getSessionStorage();
  if (!ss) {
    return;
  }
  try {
    ss.setItem(key, value);
  } catch {
    // Ignore storage quota/security errors
  }
}

function getSessionItem(key: string): string | null {
  const ss = getSessionStorage();
  if (!ss) {
    return null;
  }
  try {
    return ss.getItem(key);
  } catch {
    return null;
  }
}

function removeSessionKeys(keys: readonly string[]): void {
  const ss = getSessionStorage();
  if (!ss) {
    return;
  }
  for (const key of keys) {
    try {
      ss.removeItem(key);
    } catch {
      // Ignore storage access errors
    }
  }
}

export function savePkceTransaction(verifier: string, state: string): void {
  setSessionItem(PKCE_VERIFIER_KEY, verifier);
  setSessionItem(PKCE_STATE_KEY, state);
  removeLegacyLocalStorageKeys([PKCE_VERIFIER_KEY, PKCE_STATE_KEY]);
}

export function readPkceTransaction(): { codeVerifier: string; state: string } {
  return {
    codeVerifier: getSessionItem(PKCE_VERIFIER_KEY) ?? '',
    state: getSessionItem(PKCE_STATE_KEY) ?? '',
  };
}

export function clearPkceTransaction(): void {
  removeSessionKeys([PKCE_VERIFIER_KEY, PKCE_STATE_KEY]);
  removeLegacyLocalStorageKeys([PKCE_VERIFIER_KEY, PKCE_STATE_KEY]);
}

export function writeWarhammerTokenCache(code: string, bearer: string): void {
  setSessionItem(PKCE_TOKEN_CACHE_KEY, JSON.stringify({ code, bearer }));
  removeLegacyLocalStorageKeys([PKCE_TOKEN_CACHE_KEY]);
}

export function readCachedWarhammerTokenEntry(): WarhammerTokenCacheEntry | null {
  const raw = getSessionItem(PKCE_TOKEN_CACHE_KEY);
  if (!raw) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null;
    }
    const record = parsed as Record<string, unknown>;
    return {
      code: typeof record['code'] === 'string' ? record['code'] : undefined,
      bearer: typeof record['bearer'] === 'string' ? record['bearer'] : undefined,
    };
  } catch (err) {
    console.warn('Failed to parse cached Warhammer token entry:', err);
    return null;
  }
}

export function readCachedWarhammerBearer(): string | null {
  const entry = readCachedWarhammerTokenEntry();
  if (!entry || typeof entry.bearer !== 'string') {
    return null;
  }
  const token = entry.bearer.trim();
  return token.length > 0 ? token : null;
}

export function clearWarhammerTokenCache(): void {
  removeSessionKeys([PKCE_TOKEN_CACHE_KEY, PKCE_VERIFIER_KEY, PKCE_STATE_KEY]);
  removeLegacyLocalStorageKeys([PKCE_TOKEN_CACHE_KEY, PKCE_VERIFIER_KEY, PKCE_STATE_KEY]);
}
