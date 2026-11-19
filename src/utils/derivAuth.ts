export * from './auth';
import { initiateLogin, initiateSignUp, exchangeCodeForTokens } from './auth';

export const DEFAULT_APP_ID = (import.meta as any).env?.VITE_DERIV_APP_ID || '1089';

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

export { exchangeCodeForTokens as exchangeDerivCodeForToken };
