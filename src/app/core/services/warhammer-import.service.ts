import { Injectable, inject } from '@angular/core';
import { getFirebaseHandles } from './firebase.config';
import { httpsCallable } from 'firebase/functions';
import { UserStateService } from './user-state.service';
import { CatalogService } from './catalog.service';

const PKCE_VERIFIER_KEY = 'whc_pkce_code_verifier';
const PKCE_STATE_KEY = 'whc_pkce_state';
const PKCE_TOKEN_CACHE_KEY = 'whc_pkce_token_cache';

const AUTH0_CLIENT_ID = 'GfkrpDHeRsWqbwJM1tB6deAjJnd8U8jp';
const AUTH0_REDIRECT_URI =
  'citadel-colour://login.mywarhammer.com/android/com.gamesworkshop.citadelpaint/callback';
const AUTH0_AUDIENCE = 'https://warhammer-paint.com/app';
const AUTH0_SCOPE = 'openid profile offline_access';
const AUTH0_TOKEN_PROXY_URL = '/gw-auth-api/oauth/token';

const DEFAULT_FILTERS_BODY = '{}';

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

  /**
   * Generates a fresh OAuth2 PKCE authorization URL for `login.mywarhammer.com`
   * matching the official Citadel Colour Android app (`com.gamesworkshop.citadelpaint` v3.1.1)
   * parameters, and saves `code_verifier` in `localStorage` + `sessionStorage` so the user
   * can exchange their callback URL even after signing in via an Incognito window.
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

    sessionStorage.setItem(PKCE_VERIFIER_KEY, codeVerifier);
    sessionStorage.setItem(PKCE_STATE_KEY, state);
    localStorage.setItem(PKCE_VERIFIER_KEY, codeVerifier);
    localStorage.setItem(PKCE_STATE_KEY, state);

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
   * Parses a pasted `citadel-colour://.../callback?code=...` URL, exchanges it via
   * either the `importMyWarhammerAccount` Firebase Cloud Function or direct Auth0 PKCE +
   * REST API calls, and merges into `UserStateService`.
   */
  async exchangeCallbackAndImport(
    callbackUrlInput: string,
    mode: 'merge' | 'replace' = 'merge'
  ): Promise<void> {
    const trimmed = callbackUrlInput.trim();
    let code: string | null = null;
    try {
      const normalizedUrl = trimmed.replace(/^citadel-colour:\/\//, 'https://');
      const parsed = new URL(normalizedUrl);
      code = parsed.searchParams.get('code');
    } catch {
      // Allow pasting raw authorization code directly
      if (trimmed.length > 10 && !trimmed.includes(' ')) {
        code = trimmed;
      }
    }

    if (!code) {
      throw new Error(
        'Could not find a valid ?code=... parameter in the pasted URL. Make sure you copied the full citadel-colour://.../callback?code=... link.'
      );
    }

    const codeVerifier =
      sessionStorage.getItem(PKCE_VERIFIER_KEY) ??
      localStorage.getItem(PKCE_VERIFIER_KEY) ??
      '';

    if (!codeVerifier) {
      throw new Error(
        'Missing PKCE code_verifier. Click "Open My Warhammer Login" or "Copy Login URL to Clipboard" in this browser first, sign in, and then paste the callback URL here.'
      );
    }

    const fb = getFirebaseHandles();
    if (fb) {
      try {
        const callable = httpsCallable<
          { code: string; codeVerifier: string },
          Record<string, unknown>
        >(fb.functions, 'importMyWarhammerAccount');

        const result = await callable({ code, codeVerifier });
        this.userState.importAccountPayload(result.data, mode);
        return;
      } catch {
        // Fall through to direct browser / dev-proxy token exchange
      }
    }

    const payload = await this.exchangeDirectlyInBrowser(code, codeVerifier);
    this.userState.importAccountPayload(payload, mode);
  }

  /**
   * Exchanges the Auth0 authorization code via the same-origin dev proxy (`/gw-auth-api/oauth/token`)
   * and fetches the user's Inventory, Wishlist, and Projects from `/gw-paint-api`.
   */
  private async exchangeDirectlyInBrowser(
    code: string,
    codeVerifier: string
  ): Promise<Record<string, unknown>> {
    let bearer = '';
    let fallbackBearer = '';

    try {
      const cachedRaw =
        sessionStorage.getItem(PKCE_TOKEN_CACHE_KEY) ??
        localStorage.getItem(PKCE_TOKEN_CACHE_KEY);
      if (cachedRaw) {
        const cached = JSON.parse(cachedRaw) as { code?: string; bearer?: string };
        if (cached.bearer) {
          fallbackBearer = cached.bearer;
          if (cached.code === code) {
            bearer = cached.bearer;
          }
        }
      }
    } catch {
      // Ignore cache parse errors
    }

    if (!bearer) {
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
      });

      const tokenContentType = tokenResp.headers.get('content-type') ?? '';
      if (tokenResp.status === 404 || tokenContentType.includes('text/html')) {
        throw new Error(
          'Local proxy (/gw-auth-api) is not active yet. Please stop and restart `npm run start` (or `pnpm run start`) in your terminal so Angular loads proxy.conf.json, then click Exchange & Import again.'
        );
      }

      if (!tokenResp.ok) {
        if (fallbackBearer) {
          bearer = fallbackBearer;
        } else {
          const errBody = await tokenResp.text();
          throw new Error(
            `My Warhammer token exchange failed (${tokenResp.status}): ${errBody}`
          );
        }
      } else {
        const tokenJson = (await tokenResp.json()) as {
          access_token?: string;
          id_token?: string;
        };
        bearer = tokenJson.access_token || tokenJson.id_token || '';
        if (!bearer) {
          throw new Error('No access_token returned from login.mywarhammer.com.');
        }

        const cachePayload = JSON.stringify({ code, bearer });
        sessionStorage.setItem(PKCE_TOKEN_CACHE_KEY, cachePayload);
        localStorage.setItem(PKCE_TOKEN_CACHE_KEY, cachePayload);
      }
    }

    const fetchApi = async <T>(path: string, method: 'GET' | 'POST' = 'GET', body?: string): Promise<T> => {
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

    const detailedProjects = await Promise.all(
      (projectsSummary ?? []).map(async (p) => {
        try {
          return await fetchApi<Record<string, unknown>>(`/projects/${p.id}?locale=en`, 'GET');
        } catch {
          return p as Record<string, unknown>;
        }
      })
    );

    return {
      inventoryPaintIds: (inventoryList ?? []).map((p) => p.id).filter(Boolean),
      wishlistPaintIds: (wishlistList ?? []).map((p) => p.id).filter(Boolean),
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
    const listTypeIdx = headers.findIndex((h) => h === 'list_type' || h === 'status' || h === 'type');

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
      if (!pid) continue;
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
