import { Injectable, inject } from '@angular/core';
import { getFirebaseHandles } from './firebase.config';
import { httpsCallable } from 'firebase/functions';
import { UserStateService } from './user-state.service';
import { CatalogService } from './catalog.service';

const PKCE_VERIFIER_KEY = 'whc_pkce_code_verifier';
const PKCE_STATE_KEY = 'whc_pkce_state';

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
   * matching the official Citadel Colour Android app parameters, and saves
   * `code_verifier` in `sessionStorage` so the user can exchange their callback URL.
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

    const params = new URLSearchParams({
      client_id: '256418625992-265571283910099920',
      response_type: 'code',
      redirect_uri:
        'citadel-colour://login.mywarhammer.com/android/com.gamesworkshop.citadelpaint/callback',
      scope: 'openid profile email offline_access',
      audience: 'https://login.mywarhammer.com/userinfo',
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
   * the `importMyWarhammerAccount` Firebase Cloud Function, and merges into `UserStateService`.
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

    const codeVerifier = sessionStorage.getItem(PKCE_VERIFIER_KEY) ?? '';
    const fb = getFirebaseHandles();
    if (!fb) {
      throw new Error(
        'To exchange live Auth0 codes directly in the browser, connect your Firebase project with the deployed `importMyWarhammerAccount` Cloud Function, or upload your extracted `user_account.json` file below.'
      );
    }

    const callable = httpsCallable<
      { code: string; codeVerifier: string },
      Record<string, unknown>
    >(fb.functions, 'importMyWarhammerAccount');

    const result = await callable({ code, codeVerifier });
    this.userState.importAccountPayload(result.data, mode);
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
