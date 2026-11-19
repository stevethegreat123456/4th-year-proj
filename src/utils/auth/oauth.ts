import type { AuthConfig, AuthInfo, CallbackParams, TokenExchangeParams } from './types';
import { generateRandomBase64url, sha256Base64url } from './crypto';
import {
  storeCSRFToken,
  getCSRFToken,
  clearCSRFToken,
  storeCodeVerifier,
  getCodeVerifier,
  clearCodeVerifier,
  storeOAuthContext,
  storeAuthInfo,
  clearAllAuthData,
} from './storage';

export const AUTH_BASE_URL = 'https://auth.deriv.com/oauth2';

export function getAuthBaseUrl(): string {
  return AUTH_BASE_URL;
}

export class OAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OAuthError';
  }
}

/**
 * Build the base PKCE URLSearchParams shared by login and sign-up.
 * Stores a fresh CSRF token, code verifier, and OAuth context.
 */
async function buildPkceParams(config: AuthConfig): Promise<URLSearchParams> {
  const csrfToken = generateRandomBase64url(32);
  const codeVerifier = generateRandomBase64url(32);
  const codeChallenge = await sha256Base64url(codeVerifier);

  storeCSRFToken(csrfToken);
  storeCodeVerifier(codeVerifier);
  storeOAuthContext(config.clientId, config.redirectUri);

  return new URLSearchParams({
    // 'trade' only: requesting a scope the app is not registered with is
    // rejected outright (error=invalid_scope), so the default stays minimal.
    scope: config.scopes ?? 'trade',
    response_type: 'code',
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    state: csrfToken,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  });
}

function appendAttributionParams(params: URLSearchParams, config: AuthConfig): void {
  if (config.affiliateToken) {
    const tokenParam = config.affiliateTokenParam ?? 't';
    params.set(tokenParam, config.affiliateToken);
  }
  if (config.utmSource) params.set('utm_source', config.utmSource);
  if (config.utmMedium) params.set('utm_medium', config.utmMedium);
  if (config.utmCampaign) params.set('utm_campaign', config.utmCampaign);
  if (config.lang) params.set('lang', config.lang.toUpperCase());
}

/**
 * Build the OAuth 2.0 login authorization URL with PKCE parameters.
 */
export async function buildAuthorizationUrl(config: AuthConfig): Promise<string> {
  const params = await buildPkceParams(config);
  appendAttributionParams(params, config);
  return `${getAuthBaseUrl()}/auth?${params.toString()}`;
}

/**
 * Build the OAuth 2.0 sign-up authorization URL (prompt=registration).
 */
export async function buildSignUpUrl(config: AuthConfig): Promise<string> {
  const params = await buildPkceParams(config);
  params.set('prompt', 'registration');
  appendAttributionParams(params, config);
  return `${getAuthBaseUrl()}/auth?${params.toString()}`;
}

function navigateToAuthUrl(url: string): void {
  const isInIframe = typeof window !== 'undefined' && window.self !== window.top;
  if (isInIframe) {
    try {
      window.top!.location.href = url;
      return;
    } catch {
      window.open(url, '_blank', 'noopener,noreferrer');
      return;
    }
  }
  window.location.href = url;
}

/**
 * Initiate login by redirecting to the Deriv auth page.
 */
export async function initiateLogin(config: AuthConfig): Promise<void> {
  const url = await buildAuthorizationUrl(config);
  navigateToAuthUrl(url);
}

/**
 * Initiate sign-up by redirecting to the Deriv registration page.
 */
export async function initiateSignUp(config: AuthConfig): Promise<void> {
  const url = await buildSignUpUrl(config);
  navigateToAuthUrl(url);
}

/**
 * Parse callback URL parameters from the OAuth redirect.
 */
export function parseCallbackParams(url: string): CallbackParams {
  const urlObj = new URL(url);
  return {
    code: urlObj.searchParams.get('code'),
    state: urlObj.searchParams.get('state'),
    scope: urlObj.searchParams.get('scope'),
    error: urlObj.searchParams.get('error'),
    error_description: urlObj.searchParams.get('error_description'),
  };
}

/**
 * Validate the OAuth callback parameters.
 * Returns the authorization code on success, or throws on failure.
 */
export function validateCallback(params: CallbackParams, redirectUri: string): string {
  if (params.error) {
    cleanupUrl(redirectUri);
    throw new OAuthError(`OAuth error: ${params.error}${params.error_description ? ` - ${params.error_description}` : ''}`);
  }

  if (!params.state) {
    clearAllAuthData();
    cleanupUrl(redirectUri);
    throw new OAuthError('Missing state parameter — possible CSRF attack');
  }

  const storedToken = getCSRFToken();
  if (!storedToken || storedToken !== params.state) {
    clearAllAuthData();
    cleanupUrl(redirectUri);
    throw new OAuthError('CSRF token mismatch — please try logging in again.');
  }

  clearCSRFToken();

  if (!params.code) {
    throw new OAuthError('Missing authorization code');
  }

  return params.code;
}

/**
 * Exchange authorization code for access and refresh tokens.
 * Uses backend proxy /api/deriv/oauth/token to avoid CORS issues.
 */
export async function exchangeCodeForTokens(params: TokenExchangeParams): Promise<AuthInfo> {
  const response = await fetch('/api/deriv/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      code: params.code,
      client_id: params.clientId,
      redirect_uri: params.redirectUri,
      code_verifier: params.codeVerifier,
    }),
  });

  const tokenData = await response.json().catch(() => ({}));

  if (!response.ok || tokenData.error) {
    const desc = tokenData.error_description || tokenData.error || response.statusText;
    throw new OAuthError(`Token exchange failed (${response.status}): ${desc}`);
  }

  const expiresIn = Number(tokenData.expires_in) || 3600;
  const authInfo: AuthInfo = {
    access_token: tokenData.access_token,
    token_type: tokenData.token_type || 'Bearer',
    expires_in: expiresIn,
    expires_at: tokenData.expires_at ?? Math.floor(Date.now() / 1000) + expiresIn,
    scope: tokenData.scope || 'trade',
    refresh_token: tokenData.refresh_token || '',
  };

  storeAuthInfo(authInfo);
  clearCodeVerifier();

  return authInfo;
}

/**
 * Refresh an expired access token using the refresh token.
 */
export async function refreshAccessToken(
  refreshToken: string,
  clientId: string
): Promise<AuthInfo> {
  const response = await fetch('/api/deriv/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: clientId,
    }),
  });

  const tokenData = await response.json().catch(() => ({}));

  if (!response.ok || tokenData.error) {
    clearAllAuthData();
    throw new OAuthError(`Token refresh failed (${response.status})`);
  }

  const expiresIn = Number(tokenData.expires_in) || 3600;
  const authInfo: AuthInfo = {
    access_token: tokenData.access_token,
    token_type: tokenData.token_type || 'Bearer',
    expires_in: expiresIn,
    expires_at: tokenData.expires_at ?? Math.floor(Date.now() / 1000) + expiresIn,
    scope: tokenData.scope || 'trade',
    refresh_token: tokenData.refresh_token || refreshToken,
  };

  storeAuthInfo(authInfo);
  return authInfo;
}

/**
 * Handle the complete OAuth callback flow:
 * validate -> exchange code -> return auth info.
 */
export async function handleOAuthCallback(
  callbackUrl: string,
  config: AuthConfig
): Promise<AuthInfo> {
  const params = parseCallbackParams(callbackUrl);
  const code = validateCallback(params, config.redirectUri);

  const codeVerifier = getCodeVerifier();
  if (!codeVerifier) {
    throw new OAuthError('Code verifier expired or missing — please try logging in again.');
  }

  const authInfo = await exchangeCodeForTokens({
    code,
    clientId: config.clientId,
    redirectUri: config.redirectUri,
    codeVerifier,
  });

  cleanupUrl(config.redirectUri);
  return authInfo;
}

/**
 * Clean OAuth parameters from the URL using history.replaceState.
 */
export function cleanupUrl(_baseUrl?: string): void {
  if (typeof window === 'undefined') return;

  const url = new URL(window.location.href);
  const paramsToRemove = ['code', 'state', 'scope', 'error', 'error_description'];
  paramsToRemove.forEach((param) => url.searchParams.delete(param));

  window.history.replaceState(window.history.state, '', url.pathname + url.search);
}
