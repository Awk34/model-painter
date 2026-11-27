/**
 * Stateless Firebase Cloud Function (`importMyWarhammerAccount`)
 *
 * Exchanges an Auth0 PKCE authorization `code` + `codeVerifier` against
 * `https://login.mywarhammer.com/oauth/token`, queries `https://api.apps.paint.warhammer.com`
 * for the authenticated user's live `/inventory`, `/wishlist`, and `/projects`,
 * and returns the normalized JSON payload to the browser without persisting credentials.
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as logger from 'firebase-functions/logger';

const AUTH0_TOKEN_URL = 'https://login.mywarhammer.com/oauth/token';
const AUTH0_CLIENT_ID = 'GfkrpDHeRsWqbwJM1tB6deAjJnd8U8jp';
const AUTH0_REDIRECT_URI =
  'citadel-colour://login.mywarhammer.com/android/com.gamesworkshop.citadelpaint/callback';
const WARHAMMER_PAINT_API_URL = 'https://api.apps.paint.warhammer.com';
const DEFAULT_FILTERS_BODY = '{}';

const UPSTREAM_TIMEOUT_MS = 15_000;
const PROJECT_DETAIL_CONCURRENCY = 4;
const SAFE_ID_RE = /^[a-zA-Z0-9_-]{1,128}$/;
const CODE_VERIFIER_RE = /^[A-Za-z0-9._~-]{43,128}$/;

const ALLOWED_ORIGINS: Array<string | RegExp> = [
  'https://model-painter-a8724.web.app',
  'https://model-painter-a8724.firebaseapp.com',
  /^https:\/\/model-painter-a8724--[a-z0-9-]+\.web\.app$/,
  /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/,
];

function isTimeoutError(err: unknown): boolean {
  return (
    err instanceof Error &&
    (err.name === 'TimeoutError' || err.name === 'AbortError')
  );
}

function extractEntityIds(rawList: unknown): string[] {
  if (!Array.isArray(rawList)) {
    throw new HttpsError('internal', 'Unexpected response format from Citadel Colour service.');
  }
  return rawList
    .map((item) =>
      item && typeof item === 'object' && typeof (item as { id?: unknown }).id === 'string'
        ? (item as { id: string }).id.trim()
        : ''
    )
    .filter((id) => id.length > 0);
}

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T) => Promise<R>
): Promise<R[]> {
  if (items.length === 0) {
    return [];
  }
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workerCount = Math.min(concurrency, items.length);
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < items.length) {
        const idx = nextIndex++;
        results[idx] = await worker(items[idx]);
      }
    })
  );
  return results;
}

export const importMyWarhammerAccount = onCall(
  {
    enforceAppCheck: true,
    maxInstances: 10,
    timeoutSeconds: 60,
    cors: ALLOWED_ORIGINS,
  },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError(
        'unauthenticated',
        'Firebase authentication is required to import My Warhammer account data.'
      );
    }

    if (!request.data || typeof request.data !== 'object' || Array.isArray(request.data)) {
      throw new HttpsError('invalid-argument', 'Request payload must be an object.');
    }

    const rawData = request.data as Record<string, unknown>;
    const rawCode = rawData.code;
    const rawCodeVerifier = rawData.codeVerifier;

    if (typeof rawCode !== 'string' || typeof rawCodeVerifier !== 'string') {
      throw new HttpsError(
        'invalid-argument',
        'Both `code` and `codeVerifier` are required strings for Auth0 PKCE token exchange.'
      );
    }

    const code = rawCode.trim();
    const codeVerifier = rawCodeVerifier.trim();

    if (!code || code.length > 2048 || /[\s\u0000-\u001f\u007f]/.test(code)) {
      throw new HttpsError('invalid-argument', 'Authorization `code` format is invalid.');
    }

    if (!CODE_VERIFIER_RE.test(codeVerifier)) {
      throw new HttpsError('invalid-argument', 'PKCE `codeVerifier` format is invalid.');
    }

    const uid = request.auth.uid;

    // 1. Exchange PKCE code for bearer token
    let tokenResp: Response;
    try {
      tokenResp = await fetch(AUTH0_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          grant_type: 'authorization_code',
          client_id: AUTH0_CLIENT_ID,
          code,
          code_verifier: codeVerifier,
          redirect_uri: AUTH0_REDIRECT_URI,
        }),
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      });
    } catch (err) {
      if (isTimeoutError(err)) {
        logger.warn('Auth0 token exchange timed out', { uid });
        throw new HttpsError(
          'deadline-exceeded',
          'My Warhammer authentication timed out. Please try again.'
        );
      }
      logger.error('Auth0 token exchange network failure', {
        uid,
        error: err instanceof Error ? err.message : String(err),
      });
      throw new HttpsError(
        'unavailable',
        'Unable to reach My Warhammer authentication service.'
      );
    }

    if (!tokenResp.ok) {
      let errSnippet = '';
      try {
        errSnippet = (await tokenResp.text()).slice(0, 300);
      } catch {
        errSnippet = '';
      }
      logger.warn('Auth0 token exchange failed', {
        uid,
        status: tokenResp.status,
        detail: errSnippet,
      });
      throw new HttpsError(
        'unauthenticated',
        'My Warhammer token exchange failed. Please start a fresh login and try again.'
      );
    }

    let tokenJson: unknown;
    try {
      tokenJson = await tokenResp.json();
    } catch (err) {
      logger.error('Invalid JSON from Auth0 token endpoint', {
        uid,
        error: err instanceof Error ? err.message : String(err),
      });
      throw new HttpsError('internal', 'Invalid response from My Warhammer authentication service.');
    }

    const parsedToken =
      tokenJson && typeof tokenJson === 'object' ? (tokenJson as Record<string, unknown>) : {};
    const rawBearer =
      typeof parsedToken.access_token === 'string' && parsedToken.access_token.trim()
        ? parsedToken.access_token.trim()
        : typeof parsedToken.id_token === 'string' && parsedToken.id_token.trim()
          ? parsedToken.id_token.trim()
          : '';

    if (!rawBearer) {
      logger.warn('No bearer token returned from Auth0', { uid });
      throw new HttpsError('unauthenticated', 'No bearer token returned from My Warhammer.');
    }

    const headers = {
      Accept: 'application/json',
      Authorization: `Bearer ${rawBearer}`,
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
      let resp: Response;
      try {
        resp = await fetch(`${WARHAMMER_PAINT_API_URL}${path}`, {
          method,
          headers: reqHeaders,
          body,
          signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
        });
      } catch (err) {
        if (isTimeoutError(err)) {
          logger.warn('Citadel Colour API request timed out', { uid, path });
          throw new HttpsError(
            'deadline-exceeded',
            'Citadel Colour service timed out. Please try again.'
          );
        }
        logger.error('Citadel Colour API network error', {
          uid,
          path,
          error: err instanceof Error ? err.message : String(err),
        });
        throw new HttpsError(
          'unavailable',
          'Unable to reach Citadel Colour service.'
        );
      }

      if (!resp.ok) {
        logger.warn('Citadel Colour REST API returned error status', {
          uid,
          path,
          status: resp.status,
        });
        throw new HttpsError(
          'internal',
          'Citadel Colour service rejected the import request.'
        );
      }

      try {
        return (await resp.json()) as T;
      } catch (err) {
        logger.error('Invalid JSON from Citadel Colour REST API', {
          uid,
          path,
          error: err instanceof Error ? err.message : String(err),
        });
        throw new HttpsError('internal', 'Invalid response from Citadel Colour service.');
      }
    };

    // 2. Query Citadel Colour v3 REST API for user account data
    const [inventoryList, wishlistList, projectsSummary] = await Promise.all([
      fetchApi<unknown>('/inventory/paints?locale=en', 'POST', DEFAULT_FILTERS_BODY),
      fetchApi<unknown>('/wishlist/paints?locale=en', 'POST', DEFAULT_FILTERS_BODY),
      fetchApi<unknown>('/projects?locale=en', 'GET'),
    ]);

    const inventoryPaintIds = extractEntityIds(inventoryList);
    const wishlistPaintIds = extractEntityIds(wishlistList);

    if (!Array.isArray(projectsSummary)) {
      throw new HttpsError('internal', 'Unexpected projects format from Citadel Colour service.');
    }

    const detailedProjects = await mapWithConcurrency(
      projectsSummary,
      PROJECT_DETAIL_CONCURRENCY,
      async (p) => {
        if (!p || typeof p !== 'object' || Array.isArray(p)) {
          return p as Record<string, unknown>;
        }
        const summaryObj = p as Record<string, unknown>;
        const projectId = typeof summaryObj.id === 'string' ? summaryObj.id.trim() : '';
        if (!SAFE_ID_RE.test(projectId)) {
          logger.warn('Skipping project detail fetch for unsafe project ID', { uid });
          return summaryObj;
        }
        try {
          return await fetchApi<Record<string, unknown>>(
            `/projects/${encodeURIComponent(projectId)}?locale=en`
          );
        } catch (err) {
          logger.warn('Project detail fetch failed; falling back to summary', {
            uid,
            projectId,
            error: err instanceof Error ? err.message : String(err),
          });
          return summaryObj;
        }
      }
    );

    return {
      inventoryPaintIds,
      wishlistPaintIds,
      projects: detailedProjects,
      importedAt: new Date().toISOString(),
    };
  }
);
