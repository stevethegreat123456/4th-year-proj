import type { AuthInfo, DerivAccount, StoredCSRFToken, StoredCodeVerifier } from './types';

const CSRF_TOKEN_KEY = 'oauth_csrf_token';
const CODE_VERIFIER_KEY = 'oauth_code_verifier';
const OAUTH_CLIENT_ID_KEY = 'oauth_client_id';
const OAUTH_REDIRECT_URI_KEY = 'oauth_redirect_uri';
const AUTH_INFO_KEY = 'auth_info';
const DERIV_ACCOUNTS_KEY = 'deriv_accounts';
const ACTIVE_LOGINID_KEY = 'active_loginid';
const ACCOUNT_TYPE_KEY = 'account_type';

const TOKEN_MAX_AGE_MS = 10 * 60 * 1000; // 10 minutes

function safeGet(storage: Storage | undefined, key: string): string | null {
  try {
    return storage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function safeSet(storage: Storage | undefined, key: string, value: string): void {
  try {
    storage?.setItem(key, value);
  } catch {}
}

function safeRemove(storage: Storage | undefined, key: string): void {
  try {
    storage?.removeItem(key);
  } catch {}
}

// --- CSRF Token ---

export function storeCSRFToken(token: string): void {
  if (typeof window === 'undefined') return;
  const stored: StoredCSRFToken = { value: token, createdAt: Date.now() };
  const serialized = JSON.stringify(stored);
  safeSet(window.sessionStorage, CSRF_TOKEN_KEY, serialized);
  safeSet(window.localStorage, CSRF_TOKEN_KEY, serialized);
}

export function getCSRFToken(): string | null {
  if (typeof window === 'undefined') return null;
  const raw =
    safeGet(window.sessionStorage, CSRF_TOKEN_KEY) ||
    safeGet(window.localStorage, CSRF_TOKEN_KEY);
  if (!raw) return null;

  try {
    const stored: StoredCSRFToken = JSON.parse(raw);
    if (Date.now() - stored.createdAt > TOKEN_MAX_AGE_MS) {
      clearCSRFToken();
      return null;
    }
    return stored.value;
  } catch {
    clearCSRFToken();
    return null;
  }
}

export function clearCSRFToken(): void {
  if (typeof window === 'undefined') return;
  safeRemove(window.sessionStorage, CSRF_TOKEN_KEY);
  safeRemove(window.localStorage, CSRF_TOKEN_KEY);
}

// --- PKCE Code Verifier ---

export function storeCodeVerifier(verifier: string): void {
  if (typeof window === 'undefined') return;
  const stored: StoredCodeVerifier = { value: verifier, createdAt: Date.now() };
  const serialized = JSON.stringify(stored);
  safeSet(window.sessionStorage, CODE_VERIFIER_KEY, serialized);
  safeSet(window.localStorage, CODE_VERIFIER_KEY, serialized);
}

export function getCodeVerifier(): string | null {
  if (typeof window === 'undefined') return null;
  const raw =
    safeGet(window.sessionStorage, CODE_VERIFIER_KEY) ||
    safeGet(window.localStorage, CODE_VERIFIER_KEY);
  if (!raw) return null;

  try {
    const stored: StoredCodeVerifier = JSON.parse(raw);
    if (Date.now() - stored.createdAt > TOKEN_MAX_AGE_MS) {
      clearCodeVerifier();
      return null;
    }
    return stored.value;
  } catch {
    clearCodeVerifier();
    return null;
  }
}

export function clearCodeVerifier(): void {
  if (typeof window === 'undefined') return;
  safeRemove(window.sessionStorage, CODE_VERIFIER_KEY);
  safeRemove(window.localStorage, CODE_VERIFIER_KEY);
}

// --- OAuth Client & Redirect Context ---

export function storeOAuthContext(clientId: string, redirectUri: string): void {
  if (typeof window === 'undefined') return;
  safeSet(window.sessionStorage, OAUTH_CLIENT_ID_KEY, clientId);
  safeSet(window.localStorage, OAUTH_CLIENT_ID_KEY, clientId);
  safeSet(window.sessionStorage, OAUTH_REDIRECT_URI_KEY, redirectUri);
  safeSet(window.localStorage, OAUTH_REDIRECT_URI_KEY, redirectUri);
}

export function getStoredOAuthClientId(): string | null {
  if (typeof window === 'undefined') return null;
  return (
    safeGet(window.sessionStorage, OAUTH_CLIENT_ID_KEY) ||
    safeGet(window.localStorage, OAUTH_CLIENT_ID_KEY)
  );
}

export function getStoredOAuthRedirectUri(): string | null {
  if (typeof window === 'undefined') return null;
  return (
    safeGet(window.sessionStorage, OAUTH_REDIRECT_URI_KEY) ||
    safeGet(window.localStorage, OAUTH_REDIRECT_URI_KEY)
  );
}

// --- Auth Info ---

export function storeAuthInfo(authInfo: AuthInfo): void {
  if (typeof window === 'undefined') return;
  safeSet(window.localStorage, AUTH_INFO_KEY, JSON.stringify(authInfo));
}

export function getAuthInfo(allowExpired: boolean = false): AuthInfo | null {
  if (typeof window === 'undefined') return null;
  const raw = safeGet(window.localStorage, AUTH_INFO_KEY);
  if (!raw) return null;

  try {
    const authInfo: AuthInfo = JSON.parse(raw);
    if (!allowExpired && authInfo.expires_at && Date.now() > authInfo.expires_at * 1000) {
      return null;
    }
    return authInfo;
  } catch {
    return null;
  }
}

export function clearAuthInfo(): void {
  if (typeof window === 'undefined') return;
  safeRemove(window.localStorage, AUTH_INFO_KEY);
}

// --- Deriv Accounts ---

export function storeDerivAccounts(accounts: DerivAccount[]): void {
  if (typeof window === 'undefined') return;
  safeSet(window.localStorage, DERIV_ACCOUNTS_KEY, JSON.stringify(accounts));
}

export function getDerivAccounts(): DerivAccount[] | null {
  if (typeof window === 'undefined') return null;
  const raw = safeGet(window.localStorage, DERIV_ACCOUNTS_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function clearDerivAccounts(): void {
  if (typeof window === 'undefined') return;
  safeRemove(window.localStorage, DERIV_ACCOUNTS_KEY);
}

// --- Active Login ID ---

export function setActiveLoginId(loginId: string): void {
  if (typeof window === 'undefined') return;
  safeSet(window.localStorage, ACTIVE_LOGINID_KEY, loginId);
}

export function getActiveLoginId(): string | null {
  if (typeof window === 'undefined') return null;
  return safeGet(window.localStorage, ACTIVE_LOGINID_KEY);
}

// --- Account Type ---

export function setAccountType(type: 'demo' | 'real'): void {
  if (typeof window === 'undefined') return;
  safeSet(window.localStorage, ACCOUNT_TYPE_KEY, type);
}

export function getAccountType(): string | null {
  if (typeof window === 'undefined') return null;
  return safeGet(window.localStorage, ACCOUNT_TYPE_KEY);
}

// --- Clear All Auth Data ---

export function clearAllAuthData(): void {
  if (typeof window === 'undefined') return;
  clearCSRFToken();
  clearCodeVerifier();
  clearAuthInfo();
  clearDerivAccounts();
  safeRemove(window.localStorage, ACTIVE_LOGINID_KEY);
  safeRemove(window.localStorage, ACCOUNT_TYPE_KEY);
  safeRemove(window.localStorage, 'deriv_active_account');
  safeRemove(window.localStorage, 'deriv_api_token');
  safeRemove(window.localStorage, 'authToken');
  safeRemove(window.localStorage, 'accountsList');
  safeRemove(window.localStorage, 'clientAccounts');
  safeRemove(window.localStorage, 'callback_token');
}
