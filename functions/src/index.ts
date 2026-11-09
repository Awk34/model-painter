/**
 * Stateless Firebase Cloud Function (`importMyWarhammerAccount`)
 *
 * Exchanges an Auth0 PKCE authorization `code` + `codeVerifier` against
 * `https://login.mywarhammer.com/oauth/token`, queries `https://api.apps.paint.warhammer.com`
 * for the authenticated user's live `/inventory`, `/wishlist`, and `/projects`,
 * and returns the normalized JSON payload to the browser without persisting credentials.
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https';

const AUTH0_TOKEN_URL = 'https://login.mywarhammer.com/oauth/token';
const AUTH0_CLIENT_ID = 'GfkrpDHeRsWqbwJM1tB6deAjJnd8U8jp';
const AUTH0_REDIRECT_URI =
  'citadel-colour://login.mywarhammer.com/android/com.gamesworkshop.citadelpaint/callback';
const WARHAMMER_PAINT_API_URL = 'https://api.apps.paint.warhammer.com';
const DEFAULT_FILTERS_BODY = '{}';

export const importMyWarhammerAccount = onCall(
  { cors: true },
  async (request) => {
    const { code, codeVerifier } = request.data as {
      code?: string;
      codeVerifier?: string;
    };

    if (!code || !codeVerifier) {
      throw new HttpsError(
        'invalid-argument',
        'Both `code` and `codeVerifier` are required for Auth0 PKCE token exchange.'
      );
    }

    // 1. Exchange PKCE code for bearer token
    const tokenResp = await fetch(AUTH0_TOKEN_URL, {
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

    if (!tokenResp.ok) {
      const errBody = await tokenResp.text();
      throw new HttpsError(
        'unauthenticated',
        `My Warhammer token exchange failed (${tokenResp.status}): ${errBody}`
      );
    }

    const tokenJson = (await tokenResp.json()) as {
      access_token?: string;
      id_token?: string;
    };
    const bearer = tokenJson.access_token || tokenJson.id_token;
    if (!bearer) {
      throw new HttpsError('unauthenticated', 'No bearer token returned from My Warhammer.');
    }

    const headers = {
      Accept: 'application/json',
      Authorization: `Bearer ${bearer}`,
    };

    const fetchApi = async <T>(
      path: string,
      method: 'GET' | 'POST' = 'GET',
      body?: string
    ): Promise<T> => {
      const reqHeaders: Record<string, string> = {
        ...headers,
        ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}),
      };
      const resp = await fetch(`${WARHAMMER_PAINT_API_URL}${path}`, {
        method,
        headers: reqHeaders,
        body,
      });
      if (!resp.ok) {
        throw new HttpsError(
          'internal',
          `Citadel Colour REST API request failed (${resp.status}) on ${path}.`
        );
      }
      return (await resp.json()) as T;
    };

    // 2. Query Citadel Colour v3 REST API for user account data
    const [inventoryList, wishlistList, projectsSummary] = await Promise.all([
      fetchApi<Array<{ id: string }>>('/inventory/paints?locale=en', 'POST', DEFAULT_FILTERS_BODY),
      fetchApi<Array<{ id: string }>>('/wishlist/paints?locale=en', 'POST', DEFAULT_FILTERS_BODY),
      fetchApi<Array<{ id: string }>>('/projects?locale=en', 'GET'),
    ]);

    const detailedProjects = await Promise.all(
      (projectsSummary ?? []).map(async (p) => {
        try {
          return await fetchApi<Record<string, unknown>>(`/projects/${p.id}?locale=en`);
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
);
