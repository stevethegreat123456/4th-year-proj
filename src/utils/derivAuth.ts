export * from './auth';
import { initiateLogin, initiateSignUp, exchangeCodeForTokens } from './auth';

export const DEFAULT_APP_ID = (import.meta as any).env?.VITE_DERIV_APP_ID || '1089';

/**
 * Parses legacy query parameters returned by Deriv OAuth (?acct1=...&token1=...).
 */
export function parseDerivOAuthParams(search: string) {
  if (!search) return [];
  const params = new URLSearchParams(search);
  const accounts: Array<{
    account: string;
    token: string;
    currency: string;
    isVirtual: boolean;
  }> = [];

  let index = 1;
  while (params.has(`acct${index}`) && params.has(`token${index}`)) {
    const acct = params.get(`acct${index}`) || '';
    const token = params.get(`token${index}`) || '';
    const cur = params.get(`cur${index}`) || 'USD';
    const isVirtual = acct.startsWith('VR') || acct.startsWith('DOT') || acct.toLowerCase().includes('demo');

    if (acct && token) {
      accounts.push({
        account: acct,
        token,
        currency: cur,
        isVirtual,
      });
    }
    index++;
  }

  return accounts;
}

export function getStandardRedirectUri(): string {
  if (typeof window === 'undefined') return '';
  return window.location.origin;
}

export function getDerivOAuthUrl(appId: string = DEFAULT_APP_ID): string {
  const cleanAppId = appId.trim() || DEFAULT_APP_ID;
  return `https://oauth.deriv.com/oauth2/authorize?app_id=${cleanAppId}&l=EN`;
}

export async function launchDerivPKCELogin(clientId: string, redirectUri?: string) {
  const cleanClientId = clientId.trim();
  if (!cleanClientId) {
    throw new Error('Client ID (App ID) is required to start Deriv OAuth');
  }
  await initiateLogin({
    clientId: cleanClientId,
    redirectUri: redirectUri || window.location.origin,
    scopes: 'trade',
  });
}

export async function launchDerivPKCESignUp(clientId: string, redirectUri?: string) {
  const cleanClientId = clientId.trim();
  if (!cleanClientId) {
    throw new Error('Client ID (App ID) is required to start Deriv Sign Up');
  }
  await initiateSignUp({
    clientId: cleanClientId,
    redirectUri: redirectUri || window.location.origin,
    scopes: 'trade',
  });
}

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

export { exchangeCodeForTokens as exchangeDerivCodeForToken };
