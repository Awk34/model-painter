import { Injectable, inject } from '@angular/core';
import { FirebaseFunctionsHandle, getFirebaseFunctions } from './firebase.config';
import { UserStateService } from './user-state.service';
import { CatalogService } from './catalog.service';
import {
  clearPkceTransaction,
  readCachedWarhammerBearer,
  readCachedWarhammerTokenEntry,
  readPkceTransaction,
  savePkceTransaction,
  writeWarhammerTokenCache,
} from '../utils/warhammer-pkce-storage.util';

const AUTH0_CLIENT_ID = 'GfkrpDHeRsWqbwJM1tB6deAjJnd8U8jp';
const AUTH0_REDIRECT_URI =
  'citadel-colour://login.mywarhammer.com/android/com.gamesworkshop.citadelpaint/callback';
const AUTH0_AUDIENCE = 'https://warhammer-paint.com/app';
const AUTH0_SCOPE = 'openid profile offline_access';
const AUTH0_TOKEN_PROXY_URL = '/gw-auth-api/oauth/token';

const DEFAULT_FILTERS_BODY = '{}';
const UPSTREAM_FETCH_TIMEOUT_MS = 15_000;
const PROJECT_DETAIL_CONCURRENCY = 4;
const SAFE_ENTITY_ID_RE = /^[a-zA-Z0-9_-]{1,128}$/;

const CLOUD_FUNCTION_UNAVAILABLE_CODES = new Set([
  'functions/not-found',
  'functions/unavailable',
  'functions/internal',
]);

@Injectable({
  providedIn: 'root',
})
export class WarhammerImportService {
  private readonly userState = inject(UserStateService);
  private readonly catalog = inject(CatalogService);

  private base64UrlEncode(bytes: Uint8Array): string {
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  protected isLocalDevHost(): boolean {
    if (typeof window === 'undefined') {
      return false;
    }
    const hostname = window.location.hostname;
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
  }

  getCachedBearerToken(): string | null {
    return readCachedWarhammerBearer();
  }

  protected getFirebaseFunctionsSafe(): Promise<FirebaseFunctionsHandle | null> {
    return getFirebaseFunctions();
  }

  protected async callImportCloudFunction(
    fb: FirebaseFunctionsHandle,
    code: string,
    codeVerifier: string
  ): Promise<Record<string, unknown>> {
    const callable = fb.httpsCallable<
      { code: string; codeVerifier: string },
      Record<string, unknown>
    >(fb.functions, 'importMyWarhammerAccount');
    const result = await callable({ code, codeVerifier });
    return result.data;
  }

  private isCloudFunctionUnavailableError(err: unknown): boolean {
    if (err instanceof TypeError) {
      return true;
    }
    if (err && typeof err === 'object' && 'code' in err) {
      const code = (err as { code?: unknown }).code;
      return typeof code === 'string' && CLOUD_FUNCTION_UNAVAILABLE_CODES.has(code);
    }
    return false;
  }

  /**
   * Generates a fresh OAuth2 PKCE authorization URL for `login.mywarhammer.com`
   * matching the official Citadel Colour Android app (`com.gamesworkshop.citadelpaint` v3.1.1)
   * parameters, and saves `code_verifier` + `state` in `sessionStorage` only.
   */
  async generateMyWarhammerLoginUrl(): Promise<{
    authorizeUrl: string;
    codeVerifier: string;
    state: string;
  }> {
    const verifierBytes = new Uint8Array(32);
    crypto.getRandomValues(verifierBytes);
    const codeVerifier = this.base64UrlEncode(verifierBytes);

    const stateBytes = new Uint8Array(16);
    crypto.getRandomValues(stateBytes);
    const state = this.base64UrlEncode(stateBytes);

    const encoder = new TextEncoder();
    const digest = await crypto.subtle.digest('SHA-256', encoder.encode(codeVerifier));
    const codeChallenge = this.base64UrlEncode(new Uint8Array(digest));

    savePkceTransaction(codeVerifier, state);

    const params = new URLSearchParams({
      client_id: AUTH0_CLIENT_ID,
      response_type: 'code',
      redirect_uri: AUTH0_REDIRECT_URI,
      scope: AUTH0_SCOPE,
      audience: AUTH0_AUDIENCE,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      state,
    });

    return {
      authorizeUrl: `https://login.mywarhammer.com/authorize?${params.toString()}`,
      codeVerifier,
      state,
    };
  }

  /**
   * Parses a pasted `citadel-colour://.../callback?code=...&state=...` URL, verifies OAuth
   * `state` against `sessionStorage`, exchanges the code via either the `importMyWarhammerAccount`
   * Firebase Cloud Function or (in local dev only) `/gw-auth-api`, and merges into `UserStateService`.
   */
  async exchangeCallbackAndImport(
    callbackUrlInput: string,
    mode: 'merge' | 'replace' = 'merge'
  ): Promise<void> {
    const { code, state, error, errorDescription } = this.extractCallbackParams(callbackUrlInput);
    if (error) {
      clearPkceTransaction();
      throw new Error(`My Warhammer login returned an error: ${errorDescription || error}`);
    }
    if (!code) {
      throw new Error(
        'Could not find a valid ?code=... parameter in the pasted URL. Make sure you copied the full citadel-colour://.../callback?code=...&state=... link.'
      );
    }

    try {
      const { codeVerifier, state: expectedState } = readPkceTransaction();
      if (!codeVerifier || !expectedState) {
        throw new Error(
          'Missing PKCE session state or code_verifier. Click "Open My Warhammer Login" or "Copy Login URL to Clipboard" in this browser tab first, sign in, and then paste the callback URL here.'
        );
      }

      if (!state) {
        throw new Error(
          'Missing ?state=... parameter in the pasted callback URL. Paste the full callback URL including both code and state parameters.'
        );
      }

      if (state !== expectedState) {
        throw new Error('OAuth state mismatch. Please start a fresh My Warhammer login.');
      }

      const fb = await this.getFirebaseFunctionsSafe();
      if (fb) {
        try {
          const payload = await this.callImportCloudFunction(fb, code, codeVerifier);
          this.userState.importAccountPayload(payload, mode);
          await this.catalog.clearEntityCaches();
          return;
        } catch (err) {
          if (!this.isLocalDevHost() || !this.isCloudFunctionUnavailableError(err)) {
            throw err instanceof Error
              ? err
              : new Error('My Warhammer Cloud Function import failed.');
          }
        }
      } else if (!this.isLocalDevHost()) {
        throw new Error(
          'My Warhammer Cloud Function is not configured for this deployment. Please sign in or use JSON/CSV upload.'
        );
      }

      const bearer = await this.resolveAuth0BearerToken(code, codeVerifier);
      const payload = await this.fetchWarhammerAccountPayload(bearer);
      this.userState.importAccountPayload(payload, mode);
      await this.catalog.clearEntityCaches();
    } finally {
      clearPkceTransaction();
    }
  }

  private extractCallbackParams(callbackUrlInput: string): {
    code: string | null;
    state: string | null;
    error: string | null;
    errorDescription: string | null;
  } {
    const trimmed = callbackUrlInput.trim();
    if (!trimmed) {
      return { code: null, state: null, error: null, errorDescription: null };
    }
    try {
      const normalizedUrl = trimmed.replace(/^citadel-colour:\/\//i, 'https://');
      const parsed = new URL(normalizedUrl);
      const code = parsed.searchParams.get('code')?.trim() || null;
      const state = parsed.searchParams.get('state')?.trim() || null;
      const error = parsed.searchParams.get('error')?.trim() || null;
      const errorDescription = parsed.searchParams.get('error_description')?.trim() || null;
      return { code, state, error, errorDescription };
    } catch {
      return { code: null, state: null, error: null, errorDescription: null };
    }
  }

  private async resolveAuth0BearerToken(code: string, codeVerifier: string): Promise<string> {
    const cached = readCachedWarhammerTokenEntry();
    if (cached?.code === code && cached.bearer && cached.bearer.trim()) {
      return cached.bearer.trim();
    }

    const tokenResp = await fetch(AUTH0_TOKEN_PROXY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        client_id: AUTH0_CLIENT_ID,
        code,
        code_verifier: codeVerifier,
        redirect_uri: AUTH0_REDIRECT_URI,
      }),
      signal: AbortSignal.timeout(UPSTREAM_FETCH_TIMEOUT_MS),
    });

    const tokenContentType = tokenResp.headers.get('content-type') ?? '';
    if (tokenResp.status === 404 || tokenContentType.includes('text/html')) {
      throw new Error(
        'Local proxy (/gw-auth-api) is not active yet. Please stop and restart `pnpm run start` in your terminal so Angular loads proxy.conf.json, then click Exchange & Import again.'
      );
    }

    if (!tokenResp.ok) {
      const errBody = await tokenResp.text();
      throw new Error(
        `My Warhammer token exchange failed (${tokenResp.status}): ${errBody.slice(0, 300)}`
      );
    }

    const tokenJson = (await tokenResp.json()) as {
      access_token?: string;
      id_token?: string;
    };
    const bearer = (tokenJson.access_token || tokenJson.id_token || '').trim();
    if (!bearer) {
      throw new Error('No access_token returned from login.mywarhammer.com.');
    }

    writeWarhammerTokenCache(code, bearer);
    return bearer;
  }

  private async fetchWarhammerAccountPayload(bearer: string): Promise<Record<string, unknown>> {
    const fetchApi = async <T>(
      path: string,
      method: 'GET' | 'POST' = 'GET',
      body?: string
    ): Promise<T> => {
      const headers: Record<string, string> = {
        Accept: 'application/json',
        Authorization: `Bearer ${bearer}`,
      };
      if (method === 'POST') {
        headers['Content-Type'] = 'application/json';
      }
      const resp = await fetch(`/gw-paint-api${path}`, {
        method,
        headers,
        body,
        signal: AbortSignal.timeout(UPSTREAM_FETCH_TIMEOUT_MS),
      });
      const contentType = resp.headers.get('content-type') ?? '';
      if (!resp.ok || !contentType.includes('application/json')) {
        throw new Error(`Failed to fetch ${path} from Warhammer Paint API (${resp.status}).`);
      }
      return (await resp.json()) as T;
    };

    const [inventoryList, wishlistList, projectsSummary] = await Promise.all([
      fetchApi<Array<{ id: string }>>('/inventory/paints?locale=en', 'POST', DEFAULT_FILTERS_BODY),
      fetchApi<Array<{ id: string }>>('/wishlist/paints?locale=en', 'POST', DEFAULT_FILTERS_BODY),
      fetchApi<Array<{ id: string }>>('/projects?locale=en', 'GET'),
    ]);

    const summaryList = Array.isArray(projectsSummary) ? projectsSummary : [];
    const detailedProjects: Array<Record<string, unknown>> = new Array(summaryList.length);
    for (let i = 0; i < summaryList.length; i += PROJECT_DETAIL_CONCURRENCY) {
      const chunk = summaryList.slice(i, i + PROJECT_DETAIL_CONCURRENCY);
      const chunkResults = await Promise.all(
        chunk.map(async (p) => {
          const projectId =
            p && typeof p === 'object' && typeof p.id === 'string' ? p.id.trim() : '';
          if (!SAFE_ENTITY_ID_RE.test(projectId)) {
            return p as Record<string, unknown>;
          }
          try {
            return await fetchApi<Record<string, unknown>>(
              `/projects/${encodeURIComponent(projectId)}?locale=en`,
              'GET'
            );
          } catch {
            return p as Record<string, unknown>;
          }
        })
      );
      for (let j = 0; j < chunkResults.length; j++) {
        detailedProjects[i + j] = chunkResults[j];
      }
    }

    return {
      inventoryPaintIds: (Array.isArray(inventoryList) ? inventoryList : [])
        .map((p) => p?.id)
        .filter((id): id is string => typeof id === 'string' && id.length > 0),
      wishlistPaintIds: (Array.isArray(wishlistList) ? wishlistList : [])
        .map((p) => p?.id)
        .filter((id): id is string => typeof id === 'string' && id.length > 0),
      projects: detailedProjects,
      importedAt: new Date().toISOString(),
    };
  }

  /**
   * Imports a user-selected JSON (`user_account.json` or Web App Backup) or CSV (`user_inventory_wishlist.csv`) file.
   */
  async importFromFile(file: File, mode: 'merge' | 'replace' = 'merge'): Promise<void> {
    const text = await file.text();
    if (file.name.endsWith('.csv')) {
      this.importFromCsvText(text, mode);
      return;
    }
    const parsed = JSON.parse(text) as Record<string, unknown>;
    this.userState.importAccountPayload(parsed, mode);
  }

  private importFromCsvText(csvText: string, mode: 'merge' | 'replace'): void {
    const lines = csvText
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    if (lines.length < 2) {
      throw new Error('CSV file is empty or missing rows.');
    }

    const headers = lines[0].split(',').map((h) => h.trim().replace(/^"|"$/g, '').toLowerCase());
    const idIdx = headers.findIndex((h) => h === 'paint_id' || h === 'id');
    const nameIdx = headers.findIndex((h) => h === 'paint_name' || h === 'name');
    const listTypeIdx = headers.findIndex(
      (h) => h === 'list_type' || h === 'status' || h === 'type'
    );

    const paintByName = new Map<string, string>();
    for (const p of this.catalog.paints()) {
      paintByName.set(p.name.toLowerCase(), p.id);
    }
    for (const tp of this.catalog.thirdPartyPaints()) {
      paintByName.set(tp.name.toLowerCase(), tp.id);
    }

    const inventoryPaintIds: string[] = [];
    const wishlistPaintIds: string[] = [];

    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(',').map((c) => c.trim().replace(/^"|"$/g, ''));
      let pid = idIdx >= 0 ? cols[idIdx] : '';
      if (!pid && nameIdx >= 0) {
        pid = paintByName.get((cols[nameIdx] ?? '').toLowerCase()) ?? '';
      }
      if (!pid) {
        continue;
      }
      const listType = listTypeIdx >= 0 ? (cols[listTypeIdx] ?? '').toLowerCase() : 'inventory';
      if (listType.includes('wish')) {
        wishlistPaintIds.push(pid);
      } else {
        inventoryPaintIds.push(pid);
      }
    }

    this.userState.importAccountPayload({ inventoryPaintIds, wishlistPaintIds }, mode);
  }
}
