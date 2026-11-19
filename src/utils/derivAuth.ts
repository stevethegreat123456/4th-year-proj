export interface DerivAccount {
  account: string;
  token: string;
  currency: string;
  isVirtual: boolean;
  balance?: number;
}

export const DEFAULT_APP_ID = (import.meta as any).env?.VITE_DERIV_APP_ID || '1089';

/**
 * Parses query parameters returned by Deriv OAuth 2.0.
 * Deriv returns accounts formatted as ?acct1=...&token1=...&cur1=...&acct2=...
 */
export function parseDerivOAuthParams(search: string): DerivAccount[] {
  if (!search) return [];
  const params = new URLSearchParams(search);
  const accounts: DerivAccount[] = [];

  let index = 1;
  while (params.has(`acct${index}`) && params.has(`token${index}`)) {
    const acct = params.get(`acct${index}`) || '';
    const token = params.get(`token${index}`) || '';
    const cur = params.get(`cur${index}`) || 'USD';
    const isVirtual = acct.startsWith('VR') || acct.toLowerCase().includes('demo');

    if (acct && token) {
      accounts.push({
        account: acct,
        token,
        currency: cur,
        isVirtual
      });
    }
    index++;
  }

  // Fallback for single account query strings
  if (accounts.length === 0 && params.has('token1')) {
    const acct = params.get('acct1') || 'Account 1';
    const token = params.get('token1')!;
    const cur = params.get('cur1') || 'USD';
    accounts.push({
      account: acct,
      token,
      currency: cur,
      isVirtual: acct.startsWith('VR')
    });
  }

  return accounts;
}

/**
 * Builds the official Deriv OAuth 2.0 authorization URL (Legacy or PKCE).
 */
export function getDerivOAuthUrl(appId: string = DEFAULT_APP_ID): string {
  const cleanAppId = appId.trim() || DEFAULT_APP_ID;
  return `https://oauth.deriv.com/oauth2/authorize?app_id=${cleanAppId}&l=EN`;
}

/**
 * Generates a cryptographically random code_verifier for PKCE.
 */
export function generateCodeVerifier(): string {
  const array = new Uint8Array(64);
  crypto.getRandomValues(array);
  const charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
  return Array.from(array)
    .map((v) => charset[v % charset.length])
    .join('');
}

/**
 * Derives the code_challenge from code_verifier using SHA-256 + base64url.
 */
export async function generateCodeChallenge(verifier: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const hash = await crypto.subtle.digest('SHA-256', data);
  const bytes = new Uint8Array(hash);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * Generates a random state string for CSRF protection.
 */
export function generateOAuthState(): string {
  const array = new Uint8Array(16);
  crypto.getRandomValues(array);
  return Array.from(array)
    .reduce((s, b) => s + b.toString(16).padStart(2, '0'), '');
}

/**
 * Initiates the modern Deriv OAuth 2.0 Authorization Code flow with PKCE.
 */
export async function launchDerivPKCELogin(clientId: string, redirectUri?: string) {
  const cleanClientId = clientId.trim();
  if (!cleanClientId) {
    throw new Error('Client ID (App ID) is required to start Deriv OAuth');
  }

  const verifier = generateCodeVerifier();
  const challenge = await generateCodeChallenge(verifier);
  const state = generateOAuthState();
  const targetRedirectUri = redirectUri || (typeof window !== 'undefined' ? `${window.location.origin}${window.location.pathname}` : '');

  // Store in both sessionStorage and localStorage for multi-tab and iframe compatibility
  sessionStorage.setItem('pkce_code_verifier', verifier);
  sessionStorage.setItem('oauth_state', state);
  sessionStorage.setItem('oauth_client_id', cleanClientId);
  sessionStorage.setItem('oauth_redirect_uri', targetRedirectUri);

  localStorage.setItem('pkce_code_verifier', verifier);
  localStorage.setItem('oauth_state', state);
  localStorage.setItem('oauth_client_id', cleanClientId);
  localStorage.setItem('oauth_redirect_uri', targetRedirectUri);

  const authUrl = new URL('https://auth.deriv.com/oauth2/auth');
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('client_id', cleanClientId);
  authUrl.searchParams.set('redirect_uri', targetRedirectUri);
  authUrl.searchParams.set('scope', 'trade account_manage');
  authUrl.searchParams.set('state', state);
  authUrl.searchParams.set('code_challenge', challenge);
  authUrl.searchParams.set('code_challenge_method', 'S256');

  const isInIframe = window.self !== window.top;
  if (isInIframe) {
    // Deriv blocks iframe embedding with X-Frame-Options: DENY. Open in a new tab / top window.
    try {
      window.top!.location.href = authUrl.toString();
    } catch (e) {
      window.open(authUrl.toString(), '_blank', 'noopener,noreferrer');
    }
  } else {
    window.location.href = authUrl.toString();
  }
}

/**
 * Exchanges the authorization code received in callback for an access_token.
 */
export async function exchangeDerivCodeForToken(code: string, state: string): Promise<{ access_token: string; expires_in?: number; token_type?: string }> {
  const storedState = sessionStorage.getItem('oauth_state') || localStorage.getItem('oauth_state');
  const storedVerifier = sessionStorage.getItem('pkce_code_verifier') || localStorage.getItem('pkce_code_verifier');
  const storedClientId = sessionStorage.getItem('oauth_client_id') || localStorage.getItem('oauth_client_id') || localStorage.getItem('deriv_app_id') || '';
  const storedRedirectUri = sessionStorage.getItem('oauth_redirect_uri') || localStorage.getItem('oauth_redirect_uri') || (typeof window !== 'undefined' ? `${window.location.origin}${window.location.pathname}` : '');

  // Verify state
  if (storedState && state !== storedState) {
    throw new Error('OAuth state verification failed (possible CSRF attempt)');
  }

  if (!storedVerifier) {
    throw new Error('PKCE code_verifier was not found in storage');
  }

  const response = await fetch('/api/deriv/oauth/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      code,
      code_verifier: storedVerifier,
      client_id: storedClientId,
      redirect_uri: storedRedirectUri
    })
  });

  const data = await response.json();

  if (!response.ok || data.error) {
    throw new Error(data.error_description || data.error || 'Failed to exchange authorization code for token');
  }

  // Clear PKCE storage after successful exchange
  sessionStorage.removeItem('pkce_code_verifier');
  sessionStorage.removeItem('oauth_state');
  localStorage.removeItem('pkce_code_verifier');
  localStorage.removeItem('oauth_state');

  return data;
}

/**
 * Initiates the Deriv OAuth login flow (Legacy).
 * If running inside an iframe, opens in a popup or new tab to bypass iframe X-Frame-Options policies.
 */
export function launchDerivLogin(appId: string = DEFAULT_APP_ID) {
  const url = getDerivOAuthUrl(appId);
  const isInIframe = window.self !== window.top;

  if (isInIframe) {
    const win = window.open(url, '_blank', 'noopener,noreferrer');
    if (!win) {
      window.top!.location.href = url;
    }
  } else {
    window.location.href = url;
  }
}
