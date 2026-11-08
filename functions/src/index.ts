/**
 * Stateless Firebase Cloud Function (`importMyWarhammerAccount`)
 *
 * Exchanges an Auth0 PKCE authorization `code` + `codeVerifier` against
 * `https://login.mywarhammer.com/oauth/token`, queries `https://api.citadelcolour.com`
 * for the authenticated user's live `{ user { inventory wishlist projects { ... } } }`,
 * and returns the normalized JSON payload to the browser without persisting credentials.
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https';

const AUTH0_TOKEN_URL = 'https://login.mywarhammer.com/oauth/token';
const AUTH0_CLIENT_ID = '256418625992-265571283910099920';
const AUTH0_REDIRECT_URI =
  'citadel-colour://login.mywarhammer.com/android/com.gamesworkshop.citadelpaint/callback';
const CITADEL_GRAPHQL_URL = 'https://api.citadelcolour.com';

const USER_ACCOUNT_QUERY = `
query GetUserAccount {
  user {
    inventory
    wishlist
    projects {
      id
      name
      thumbnailUrl
      createdAt
      updatedAt
      recipes {
        id
        name
      }
      colours {
        id
        name
      }
      notes {
        id
        title
        createdAt
        updatedAt
        components {
          ... on NoteTextComponent {
            type
            value: text
          }
          ... on NoteCheckboxComponent {
            type
            value: label
            checked
          }
        }
      }
    }
  }
}
`;

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
    const bearer = tokenJson.id_token || tokenJson.access_token;
    if (!bearer) {
      throw new HttpsError('unauthenticated', 'No bearer token returned from My Warhammer.');
    }

    // 2. Query Citadel Colour GraphQL API for user account data
    const gqlResp = await fetch(CITADEL_GRAPHQL_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${bearer}`,
      },
      body: JSON.stringify({ query: USER_ACCOUNT_QUERY }),
    });

    if (!gqlResp.ok) {
      throw new HttpsError(
        'internal',
        `Citadel Colour GraphQL request failed (${gqlResp.status}).`
      );
    }

    const gqlJson = (await gqlResp.json()) as {
      data?: {
        user?: {
          inventory?: string[];
          wishlist?: string[];
          projects?: unknown[];
        };
      };
    };

    const user = gqlJson.data?.user;
    if (!user) {
      throw new HttpsError('not-found', 'Could not load user profile from Citadel Colour API.');
    }

    return {
      inventoryPaintIds: user.inventory ?? [],
      wishlistPaintIds: user.wishlist ?? [],
      projects: user.projects ?? [],
      importedAt: new Date().toISOString(),
    };
  }
);
