export interface AuthConfig {
  clientId: string;
  redirectUri: string;
  /** OAuth scopes as a space-separated string. Defaults to 'trade' */
  scopes?: string;
  /** Affiliate token extracted from the partner referral link */
  affiliateToken?: string;
  /**
   * The exact parameter name to use when forwarding the affiliate token to the
   * OAuth sign-up URL. One of: 't' | 'affiliate_token' | 'sidi' | 'ca'.
   * Defaults to 't' when not set.
   */
  affiliateTokenParam?: 't' | 'affiliate_token' | 'sidi' | 'ca';
  /** UTM campaign identifier */
  utmCampaign?: string;
  /** UTM source identifier */
  utmSource?: string;
  /** UTM medium */
  utmMedium?: string;
  /** Language code upper-cased onto the authorize URL */
  lang?: string;
}

export interface AuthInfo {
  access_token: string;
  token_type: string;
  expires_in: number;
  expires_at: number;
  scope: string;
  refresh_token: string;
}

export interface DerivOptionsAccount {
  account_id: string;
  account_type: 'demo' | 'real';
  currency: string;
  balance: string;
  group: string;
  status: string;
}

export interface DerivAccount {
  account: string;
  account_id?: string;
  account_type?: 'demo' | 'real';
  token: string;
  currency: string;
  isVirtual: boolean;
  balance?: number;
  group?: string;
  status?: string;
}

export interface OTPResponse {
  data: {
    url: string;
  };
}

export interface TokenExchangeParams {
  code: string;
  clientId: string;
  redirectUri: string;
  codeVerifier: string;
}

export interface CallbackParams {
  code?: string | null;
  state?: string | null;
  scope?: string | null;
  error?: string | null;
  error_description?: string | null;
}

export type AuthState = 'unauthenticated' | 'authenticating' | 'authenticated' | 'error';

export interface StoredCSRFToken {
  value: string;
  createdAt: number;
}

export interface StoredCodeVerifier {
  value: string;
  createdAt: number;
}
