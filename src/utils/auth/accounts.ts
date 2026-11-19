import type { DerivAccount, DerivOptionsAccount, OTPResponse } from './types';
import {
  storeDerivAccounts,
  getActiveLoginId,
  setActiveLoginId,
  setAccountType,
  clearAllAuthData,
} from './storage';

export const OPTIONS_API_BASE_URL = 'https://api.derivws.com/trading/v1/options';

function mapOptionsAccount(acc: DerivOptionsAccount, accessToken: string): DerivAccount {
  const id = acc.account_id;
  const isDemo =
    acc.account_type === 'demo' ||
    id.startsWith('DOT') ||
    id.startsWith('VRT') ||
    id.startsWith('VR');

  return {
    account: id,
    account_id: id,
    account_type: isDemo ? 'demo' : 'real',
    token: accessToken,
    currency: acc.currency || 'USD',
    isVirtual: isDemo,
    balance: acc.balance !== undefined ? Number(acc.balance) : 0,
    group: acc.group,
    status: acc.status,
  };
}

export async function fetchAccounts(
  accessToken: string,
  appId?: string
): Promise<DerivAccount[]> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
  };
  if (appId && /^\d+$/.test(appId)) {
    headers['Deriv-App-ID'] = appId;
  }

  const response = await fetch(`${OPTIONS_API_BASE_URL}/accounts`, {
    method: 'GET',
    headers,
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const errMsg =
      payload?.errors?.[0]?.message ||
      payload?.error?.message ||
      payload?.message ||
      `Failed to fetch Deriv accounts (${response.status})`;
    throw new Error(errMsg);
  }

  const rawList: DerivOptionsAccount[] = Array.isArray(payload?.data)
    ? payload.data
    : Array.isArray(payload)
      ? payload
      : [];

  const mapped = rawList.map((acc) => mapOptionsAccount(acc, accessToken));
  if (mapped.length > 0) {
    storeDerivAccounts(mapped);
  }
  return mapped;
}

export async function getWebSocketOTP(
  accessToken: string,
  accountId: string,
  appId?: string
): Promise<string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
  };
  if (appId && /^\d+$/.test(appId)) {
    headers['Deriv-App-ID'] = appId;
  }

  const response = await fetch(
    `${OPTIONS_API_BASE_URL}/accounts/${encodeURIComponent(accountId)}/otp`,
    {
      method: 'POST',
      headers,
    }
  );

  const payload: OTPResponse & any = await response.json().catch(() => ({}));
  if (!response.ok || !payload?.data?.url) {
    const errMsg =
      payload?.errors?.[0]?.message ||
      payload?.error?.message ||
      payload?.message ||
      `Failed to obtain WebSocket OTP (${response.status})`;
    throw new Error(errMsg);
  }

  return payload.data.url;
}

export async function resetDemoBalance(
  accessToken: string,
  accountId: string,
  appId?: string
): Promise<number> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
  };
  if (appId && /^\d+$/.test(appId)) {
    headers['Deriv-App-ID'] = appId;
  }

  const response = await fetch(
    `${OPTIONS_API_BASE_URL}/accounts/${encodeURIComponent(accountId)}/reset-demo-balance`,
    {
      method: 'POST',
      headers,
    }
  );

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const errMsg =
      payload?.errors?.[0]?.message ||
      payload?.error?.message ||
      payload?.message ||
      `Failed to reset demo balance (${response.status})`;
    throw new Error(errMsg);
  }

  if (payload?.data?.balance !== undefined) {
    return Number(payload.data.balance);
  }

  const accounts = await fetchAccounts(accessToken, appId);
  const updated = accounts.find((a) => a.account === accountId);
  return updated?.balance ?? 10000;
}

export const DerivWSAccountsService = {
  async fetchAccountsList(accessToken: string, appId?: string): Promise<DerivAccount[]> {
    return fetchAccounts(accessToken, appId);
  },

  storeAccounts(accounts: DerivAccount[]): void {
    storeDerivAccounts(accounts);
  },

  async resetDemoBalance(accessToken: string, accountId: string, appId?: string): Promise<number> {
    return resetDemoBalance(accessToken, accountId, appId);
  },

  async getAuthenticatedWebSocketURL(
    accessToken: string,
    preferredAccountId?: string,
    appId?: string
  ): Promise<string> {
    let targetAccountId = preferredAccountId || getActiveLoginId();

    if (!targetAccountId) {
      const accounts = await fetchAccounts(accessToken, appId);
      if (accounts.length === 0) {
        throw new Error('No Deriv Options trading accounts found.');
      }
      const defaultAcc = accounts.find((a) => a.isVirtual) || accounts[0];
      targetAccountId = defaultAcc.account;
      setActiveLoginId(targetAccountId);
      setAccountType(defaultAcc.isVirtual ? 'demo' : 'real');
    }

    return getWebSocketOTP(accessToken, targetAccountId, appId);
  },
};

export function logout(): void {
  clearAllAuthData();
}
