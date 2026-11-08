// Microsoft work-account sign-in for reading the hospital schedule folder.
//
// The user signs in on Microsoft's own page (OAuth 2.0 + PKCE); the app never
// sees the password. Access is delegated and read-only: Foxory can open only
// files the user's own account can open. The refresh token stays in the
// device keychain/keystore and is never sent to Foxory's servers.

import {
  AuthRequest,
  exchangeCodeAsync,
  makeRedirectUri,
  refreshAsync,
  ResponseType,
  TokenResponse,
} from "expo-auth-session";
import * as SecureStore from "expo-secure-store";

const CLIENT_ID = process.env.EXPO_PUBLIC_MS_CLIENT_ID || "";
// "organizations": any work or school account, in any hospital's tenant.
const AUTHORITY = "https://login.microsoftonline.com/organizations/oauth2/v2.0";
const DISCOVERY = {
  authorizationEndpoint: `${AUTHORITY}/authorize`,
  tokenEndpoint: `${AUTHORITY}/token`,
};
// Read-only. offline_access gives the refresh token used for the daily sync.
const SCOPES = ["openid", "profile", "offline_access", "User.Read", "Files.Read.All", "Sites.Read.All"];

const KEY = "foxory_ms_tokens";
// Readable after the first unlock, so the background sync can run.
const STORE_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
};

type StoredTokens = { accessToken: string; refreshToken?: string; expiresAt: number; account?: string };

export class MicrosoftAuthError extends Error {
  constructor(
    message: string,
    public code: "not-configured" | "cancelled" | "admin-approval" | "failed" | "signed-out",
  ) {
    super(message);
  }
}

export function isMicrosoftConfigured(): boolean {
  return CLIENT_ID.length > 0;
}

export function redirectUri(): string {
  return makeRedirectUri({ scheme: "foxory", path: "auth" });
}

async function save(tokens: StoredTokens) {
  await SecureStore.setItemAsync(KEY, JSON.stringify(tokens), STORE_OPTIONS);
}

async function load(): Promise<StoredTokens | null> {
  try {
    const raw = await SecureStore.getItemAsync(KEY, STORE_OPTIONS);
    return raw ? (JSON.parse(raw) as StoredTokens) : null;
  } catch {
    return null;
  }
}

function toStored(token: TokenResponse, previous?: StoredTokens | null, account?: string): StoredTokens {
  return {
    accessToken: token.accessToken,
    refreshToken: token.refreshToken ?? previous?.refreshToken,
    expiresAt: Date.now() + (token.expiresIn ?? 3600) * 1000,
    account: account ?? previous?.account,
  };
}

function accountFromIdToken(idToken?: string): string | undefined {
  if (!idToken) return undefined;
  try {
    const payload = idToken.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const binary = atob(payload);
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    const json = JSON.parse(new TextDecoder().decode(bytes)) as Record<string, string>;
    return json.preferred_username || json.email || json.name;
  } catch {
    return undefined;
  }
}

/** Opens Microsoft's sign-in page. Returns the signed-in account name. */
export async function signInWithMicrosoft(): Promise<string | undefined> {
  if (!isMicrosoftConfigured())
    throw new MicrosoftAuthError("Work-account sign-in is not set up in this version yet.", "not-configured");
  const request = new AuthRequest({
    clientId: CLIENT_ID,
    scopes: SCOPES,
    redirectUri: redirectUri(),
    responseType: ResponseType.Code,
    usePKCE: true,
  });
  const result = await request.promptAsync(DISCOVERY);
  if (result.type === "cancel" || result.type === "dismiss")
    throw new MicrosoftAuthError("Sign-in was cancelled.", "cancelled");
  if (result.type === "error" || result.type !== "success") {
    const description = (result.type === "error" && (result.params?.error_description || result.error?.message)) || "";
    if (/AADSTS65001|AADSTS90094|admin|consent/i.test(description))
      throw new MicrosoftAuthError(
        "Your hospital needs to approve Foxory for work-account sign-in. Ask your IT team to approve “Foxory Shift Planner”.",
        "admin-approval",
      );
    throw new MicrosoftAuthError("Microsoft sign-in did not complete. Please try again.", "failed");
  }
  const token = await exchangeCodeAsync(
    {
      clientId: CLIENT_ID,
      code: result.params.code,
      redirectUri: redirectUri(),
      extraParams: { code_verifier: request.codeVerifier ?? "" },
    },
    DISCOVERY,
  );
  const account = accountFromIdToken(token.idToken);
  await save(toStored(token, null, account));
  return account;
}

/** A valid access token, refreshed when needed. */
export async function getMicrosoftAccessToken(): Promise<string> {
  const stored = await load();
  if (!stored) throw new MicrosoftAuthError("Sign in with your work account first.", "signed-out");
  if (stored.expiresAt - 120_000 > Date.now()) return stored.accessToken;
  if (!stored.refreshToken) throw new MicrosoftAuthError("Sign in with your work account again.", "signed-out");
  try {
    const token = await refreshAsync(
      { clientId: CLIENT_ID, refreshToken: stored.refreshToken, scopes: SCOPES },
      DISCOVERY,
    );
    const next = toStored(token, stored);
    await save(next);
    return next.accessToken;
  } catch {
    throw new MicrosoftAuthError("Your work-account session has ended. Sign in again.", "signed-out");
  }
}

export async function microsoftAccount(): Promise<string | null> {
  const stored = await load();
  return stored ? (stored.account ?? "Work account") : null;
}

/** Forget the work account on this device (tokens are only stored here). */
export async function signOutMicrosoft(): Promise<void> {
  await SecureStore.deleteItemAsync(KEY, STORE_OPTIONS);
}

/** fetch() for Microsoft Graph with the signed-in user's token. */
export async function graphFetch(url: string): Promise<Response> {
  const token = await getMicrosoftAccessToken();
  return fetch(url, { headers: { Authorization: `Bearer ${token}` } });
}
