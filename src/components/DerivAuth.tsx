import React, { useState, useEffect } from 'react';
import { useStore, DerivAccount } from '../store/useStore';
import {
  parseDerivOAuthParams,
  launchDerivPKCELogin,
  launchDerivPKCESignUp,
  launchDerivLogin,
  handleOAuthCallback,
  cleanupUrl,
  DerivWSAccountsService,
  getAuthInfo,
  getStoredOAuthClientId,
  refreshAccessToken,
  setActiveLoginId,
  setAccountType,
  DEFAULT_APP_ID
} from '../utils/derivAuth';
import {
  LogIn,
  LogOut,
  ChevronDown,
  ExternalLink,
  CheckCircle2,
  Loader2,
  Eye,
  EyeOff,
  Zap,
  RefreshCw,
  X,
  UserPlus
} from 'lucide-react';

export function DerivAuth() {
  const auth = useStore((state) => state.auth);
  const setAuth = useStore((state) => state.setAuth);
  const switchAccount = useStore((state) => state.switchAccount);
  const logout = useStore((state) => state.logout);
  const balance = useStore((state) => state.balance);
  const settings = useStore((state) => state.settings);
  const setSettings = useStore((state) => state.setSettings);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'oauth' | 'pat'>('oauth');

  const [customAppId, setCustomAppId] = useState(() => {
    if (typeof window !== 'undefined') {
      return (
        localStorage.getItem('oauth_client_id') ||
        localStorage.getItem('deriv_app_id') ||
        auth.appId ||
        DEFAULT_APP_ID
      );
    }
    return auth.appId || DEFAULT_APP_ID;
  });

  const [patInput, setPatInput] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('deriv_api_token') || '';
    }
    return '';
  });

  const [showPatToken, setShowPatToken] = useState(false);
  const [isValidatingPAT, setIsValidatingPAT] = useState(false);
  const [patSuccessMsg, setPatSuccessMsg] = useState<string | null>(null);

  const [isExchangingCode, setIsExchangingCode] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  // Minimal inline token input for legacy accounts missing a token
  const [accountAddingToken, setAccountAddingToken] = useState<DerivAccount | null>(null);
  const [tokenForAccountInput, setTokenForAccountInput] = useState('');
  const [isValidatingSubToken, setIsValidatingSubToken] = useState(false);
  const [subTokenError, setSubTokenError] = useState<string | null>(null);

  const resolveRuntimeClientId = async (): Promise<string> => {
    const stored = getStoredOAuthClientId();
    if (stored && stored !== '1089') return stored;
    if (customAppId && customAppId !== '1089') return customAppId;
    try {
      const res = await fetch('/api/config');
      const cfg = await res.json();
      if (cfg?.appId) return String(cfg.appId).trim();
    } catch {}
    return customAppId.trim() || DEFAULT_APP_ID;
  };

  // Validate and log in using Legacy Deriv Personal Access Token (PAT)
  const validateAndLoginWithPAT = (tokenToTest: string, appId: string = '1089') => {
    const cleanToken = tokenToTest.trim();
    if (!cleanToken) {
      setAuthError('Please enter your Deriv token.');
      return;
    }

    setIsValidatingPAT(true);
    setAuthError(null);
    setPatSuccessMsg(null);

    const wsAppId = /^\d+$/.test(appId.trim()) ? appId.trim() : '1089';
    let hasResponded = false;

    try {
      const ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${wsAppId}`);

      const timeout = setTimeout(() => {
        if (!hasResponded) {
          hasResponded = true;
          try { ws.close(); } catch (e) {}
          setIsValidatingPAT(false);
          setAuthError('Connection timed out.');
        }
      }, 10000);

      ws.onopen = () => {
        ws.send(JSON.stringify({ authorize: cleanToken }));
      };

      ws.onmessage = (event) => {
        if (hasResponded) return;
        try {
          const data = JSON.parse(event.data);

          if (data.error) {
            hasResponded = true;
            clearTimeout(timeout);
            try { ws.close(); } catch (e) {}
            setIsValidatingPAT(false);
            setAuthError(data.error.message || 'Invalid token or App ID.');
            return;
          }

          if (data.msg_type === 'authorize' && data.authorize) {
            hasResponded = true;
            clearTimeout(timeout);
            const authData = data.authorize;

            const isVirtual = Boolean(authData.is_virtual || authData.loginid.startsWith('VR') || authData.loginid.startsWith('D'));
            const activeAccount: DerivAccount = {
              account: authData.loginid,
              account_id: authData.loginid,
              token: cleanToken,
              currency: authData.currency || 'USD',
              isVirtual,
              balance: Number(authData.balance) || 0
            };

            const accountList = authData.account_list || [];
            const existingAccounts = auth.accounts || [];
            const accounts: DerivAccount[] = accountList.length > 0
              ? accountList.map((acc: any) => {
                  const existing = existingAccounts.find(ea => ea.account === acc.loginid);
                  const isThisAccount = acc.loginid === authData.loginid;
                  return {
                    account: acc.loginid,
                    account_id: acc.loginid,
                    token: isThisAccount ? cleanToken : (existing?.token || ''),
                    currency: acc.currency || 'USD',
                    isVirtual: Boolean(acc.is_virtual || String(acc.loginid).startsWith('VR') || String(acc.loginid).startsWith('D')),
                    balance: isThisAccount ? Number(authData.balance) : (existing?.balance || undefined)
                  };
                })
              : [activeAccount];

            setAuth({
              isLoggedIn: true,
              userName: authData.fullname,
              userEmail: authData.email,
              accounts,
              activeAccount,
              appId: wsAppId
            });

            if (typeof window !== 'undefined') {
              localStorage.setItem('deriv_api_token', cleanToken);
              localStorage.setItem('deriv_active_account', JSON.stringify(activeAccount));
              localStorage.setItem('deriv_accounts', JSON.stringify(accounts));
            }

            if (authData.balance !== undefined) {
              useStore.getState().setBalance(Number(authData.balance));
            }

            const nextSettings = {
              ...useStore.getState().settings,
              apiToken: cleanToken,
              appId: wsAppId,
              authMethod: 'pat' as const,
              activeAccountId: authData.loginid,
              accountCurrency: authData.currency || 'USD'
            };
            setSettings(nextSettings);

            window.dispatchEvent(new CustomEvent('bot_settings_changed', {
              detail: nextSettings
            }));

            setIsValidatingPAT(false);
            setPatSuccessMsg(`Connected (${authData.loginid})`);

            setTimeout(() => {
              setIsModalOpen(false);
              setPatSuccessMsg(null);
            }, 800);

            try { ws.close(); } catch (e) {}
          }
        } catch (err: any) {
          hasResponded = true;
          clearTimeout(timeout);
          try { ws.close(); } catch (e) {}
          setIsValidatingPAT(false);
          setAuthError(err.message || 'Authentication error');
        }
      };

      ws.onerror = () => {
        if (!hasResponded) {
          hasResponded = true;
          clearTimeout(timeout);
          setIsValidatingPAT(false);
          setAuthError('WebSocket connection failed.');
        }
      };
    } catch (err: any) {
      setIsValidatingPAT(false);
      setAuthError(err.message || 'Connection error');
    }
  };

  // Add or update token for a specific legacy sub-account
  const handleAddTokenToAccount = (targetAccount: DerivAccount, inputToken: string) => {
    const cleanToken = inputToken.trim();
    if (!cleanToken) {
      setSubTokenError('Enter token');
      return;
    }

    setIsValidatingSubToken(true);
    setSubTokenError(null);

    const wsAppId = /^\d+$/.test(String(auth.appId || '')) ? String(auth.appId) : '1089';
    try {
      const ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${wsAppId}`);
      let finished = false;

      const timeout = setTimeout(() => {
        if (!finished) {
          finished = true;
          try { ws.close(); } catch (e) {}
          setIsValidatingSubToken(false);
          setSubTokenError('Timed out');
        }
      }, 8000);

      ws.onopen = () => {
        ws.send(JSON.stringify({ authorize: cleanToken }));
      };

      ws.onmessage = (evt) => {
        if (finished) return;
        try {
          const res = JSON.parse(evt.data);
          if (res.error) {
            finished = true;
            clearTimeout(timeout);
            try { ws.close(); } catch (e) {}
            setIsValidatingSubToken(false);
            setSubTokenError(res.error.message || 'Invalid token');
            return;
          }

          if (res.msg_type === 'authorize' && res.authorize) {
            finished = true;
            clearTimeout(timeout);
            try { ws.close(); } catch (e) {}
            setIsValidatingSubToken(false);

            const authData = res.authorize;
            const updatedAccount: DerivAccount = {
              account: authData.loginid,
              account_id: authData.loginid,
              token: cleanToken,
              currency: authData.currency || targetAccount.currency || 'USD',
              isVirtual: Boolean(authData.is_virtual || authData.loginid.startsWith('VR') || authData.loginid.startsWith('D')),
              balance: Number(authData.balance) || 0
            };

            const currentAccounts = auth.accounts || [];
            const exists = currentAccounts.some(a => a.account === updatedAccount.account);
            const updatedAccounts = exists
              ? currentAccounts.map(a => a.account === updatedAccount.account ? updatedAccount : a)
              : [...currentAccounts, updatedAccount];

            setAuth({
              accounts: updatedAccounts,
              activeAccount: updatedAccount,
              isLoggedIn: true
            });

            if (typeof window !== 'undefined') {
              localStorage.setItem('deriv_active_account', JSON.stringify(updatedAccount));
              localStorage.setItem('deriv_accounts', JSON.stringify(updatedAccounts));
              localStorage.setItem('deriv_api_token', cleanToken);
            }

            if (authData.balance !== undefined) {
              useStore.getState().setBalance(Number(authData.balance));
            }

            const nextSettings = {
              ...useStore.getState().settings,
              apiToken: cleanToken,
              authMethod: 'pat' as const,
              activeAccountId: authData.loginid,
              accountCurrency: authData.currency || 'USD'
            };
            setSettings(nextSettings);
            window.dispatchEvent(new CustomEvent('bot_settings_changed', {
              detail: nextSettings
            }));

            setAccountAddingToken(null);
            setTokenForAccountInput('');
            setIsDropdownOpen(false);
          }
        } catch (e: any) {
          finished = true;
          clearTimeout(timeout);
          try { ws.close(); } catch (err) {}
          setIsValidatingSubToken(false);
          setSubTokenError('Error');
        }
      };

      ws.onerror = () => {
        if (!finished) {
          finished = true;
          clearTimeout(timeout);
          setIsValidatingSubToken(false);
          setSubTokenError('Connection error');
        }
      };
    } catch (err: any) {
      setIsValidatingSubToken(false);
      setSubTokenError('Connection failed');
    }
  };

  // Legacy WebSocket authorize helper (for ?acct1=...&token1=... callbacks)
  const fetchLegacyAccountDetails = (token: string, appId: string = '1089') => {
    try {
      const wsAppId = /^\d+$/.test(appId) ? appId : '1089';
      const ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${wsAppId}`);
      ws.onopen = () => ws.send(JSON.stringify({ authorize: token }));
      ws.onmessage = (msg) => {
        try {
          const data = JSON.parse(msg.data);
          if (data.msg_type === 'authorize' && data.authorize) {
            const authData = data.authorize;
            const accountList = authData.account_list || [];
            const existingAccounts = useStore.getState().auth.accounts || [];
            const accounts: DerivAccount[] = accountList.map((acc: any) => {
              const existing = existingAccounts.find(ea => ea.account === acc.loginid);
              const isCurrent = acc.loginid === authData.loginid;
              return {
                account: acc.loginid,
                account_id: acc.loginid,
                token: isCurrent ? token : (existing?.token || ''),
                currency: acc.currency || 'USD',
                isVirtual: Boolean(acc.is_virtual || String(acc.loginid).startsWith('VR') || String(acc.loginid).startsWith('D')),
                balance: isCurrent ? Number(authData.balance) : existing?.balance
              };
            });

            const activeAccount: DerivAccount = {
              account: authData.loginid,
              account_id: authData.loginid,
              token,
              currency: authData.currency || 'USD',
              isVirtual: Boolean(authData.is_virtual || String(authData.loginid).startsWith('VR') || String(authData.loginid).startsWith('D')),
              balance: Number(authData.balance) || 0
            };

            setAuth({
              isLoggedIn: true,
              userName: authData.fullname,
              userEmail: authData.email,
              accounts: accounts.length > 0 ? accounts : [activeAccount],
              activeAccount
            });

            if (authData.balance !== undefined) {
              useStore.getState().setBalance(Number(authData.balance));
            }
            ws.close();
          }
        } catch {}
      };
      ws.onerror = () => ws.close();
    } catch {}
  };

  // OAuth Callback & Session Hydration (following me.txt flow)
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const urlParams = new URLSearchParams(window.location.search);
    const hasCode = urlParams.has('code');
    const hasOAuthError = urlParams.has('error') || urlParams.has('error_description');

    // 1. Handle OAuth 2.0 PKCE Callback (?code=...&state=...) or OAuth Error
    if (hasCode || hasOAuthError) {
      const handleCallback = async () => {
        setIsExchangingCode(true);
        setAuthError(null);
        try {
          const clientId = await resolveRuntimeClientId();
          const authInfo = await handleOAuthCallback(window.location.href, {
            clientId,
            redirectUri: window.location.origin,
            scopes: 'trade',
          });

          const accounts = await DerivWSAccountsService.fetchAccountsList(authInfo.access_token);
          if (!accounts || accounts.length === 0) {
            throw new Error('No Deriv trading accounts returned after authentication.');
          }

          DerivWSAccountsService.storeAccounts(accounts);
          const firstAccount = accounts.find((a) => a.isVirtual) || accounts[0];
          const accountId = firstAccount.account_id || firstAccount.account;

          setActiveLoginId(accountId);
          setAccountType(firstAccount.isVirtual ? 'demo' : 'real');

          setAuth({
            isLoggedIn: true,
            accounts,
            activeAccount: firstAccount,
            appId: clientId,
          });

          if (firstAccount.balance !== undefined) {
            useStore.getState().setBalance(firstAccount.balance);
          }

          const nextSettings = {
            ...useStore.getState().settings,
            apiToken: authInfo.access_token,
            appId: clientId,
            authMethod: 'oauth' as const,
            activeAccountId: accountId,
            accountCurrency: firstAccount.currency || 'USD',
          };
          setSettings(nextSettings);

          window.dispatchEvent(new CustomEvent('bot_settings_changed', {
            detail: nextSettings
          }));
        } catch (err: any) {
          console.error('OAuth callback error:', err);
          setAuthError(err?.message || 'Deriv authentication failed');
          setIsModalOpen(true);
        } finally {
          cleanupUrl(window.location.origin);
          setIsExchangingCode(false);
        }
      };

      handleCallback();
      return;
    }

    // 2. Handle Legacy Deriv OAuth Callback (?acct1=...&token1=...)
    const queryAccounts = parseDerivOAuthParams(window.location.search);
    if (queryAccounts.length > 0) {
      const defaultActive = queryAccounts.find(a => a.isVirtual) || queryAccounts[0];
      setAuth({
        isLoggedIn: true,
        accounts: queryAccounts,
        activeAccount: defaultActive
      });

      const nextSettings = {
        ...useStore.getState().settings,
        apiToken: defaultActive.token,
        authMethod: 'pat' as const,
        activeAccountId: defaultActive.account,
        accountCurrency: defaultActive.currency || 'USD'
      };
      setSettings(nextSettings);
      fetchLegacyAccountDetails(defaultActive.token, customAppId || '1089');
      cleanupUrl(window.location.origin);

      window.dispatchEvent(new CustomEvent('bot_settings_changed', {
        detail: nextSettings
      }));
      return;
    }

    // 3. Auto-refresh expired OAuth session on load if refresh_token exists
    const validAuthInfo = getAuthInfo(false);
    const anyAuthInfo = getAuthInfo(true);
    if (!validAuthInfo && anyAuthInfo?.refresh_token) {
      resolveRuntimeClientId().then((clientId) => {
        refreshAccessToken(anyAuthInfo.refresh_token, clientId)
          .then(async (refreshed) => {
            const accounts = await DerivWSAccountsService.fetchAccountsList(refreshed.access_token);
            if (accounts.length > 0) {
              const currentId = useStore.getState().auth.activeAccount?.account;
              const active = accounts.find(a => a.account === currentId) || accounts.find(a => a.isVirtual) || accounts[0];
              setAuth({ isLoggedIn: true, accounts, activeAccount: active, appId: clientId });
              const nextSettings = {
                ...useStore.getState().settings,
                apiToken: refreshed.access_token,
                authMethod: 'oauth' as const,
                activeAccountId: active.account,
                accountCurrency: active.currency || 'USD',
              };
              setSettings(nextSettings);
              window.dispatchEvent(new CustomEvent('bot_settings_changed', { detail: nextSettings }));
            }
          })
          .catch(() => {});
      });
    }
  }, []);

  useEffect(() => {
    const handleOpenLogin = () => {
      setAuthError(null);
      setIsModalOpen(true);
    };
    window.addEventListener('open_deriv_login_modal', handleOpenLogin);
    return () => window.removeEventListener('open_deriv_login_modal', handleOpenLogin);
  }, []);

  useEffect(() => {
    if (auth.appId && auth.appId !== customAppId) {
      setCustomAppId(auth.appId);
    }
  }, [auth.appId, customAppId]);

  const handleOAuthLogin = async (forcedAppId?: string) => {
    const appIdToUse = (forcedAppId || customAppId).trim() || DEFAULT_APP_ID;
    setAuth({ appId: appIdToUse });
    if (typeof window !== 'undefined') {
      localStorage.setItem('deriv_app_id', appIdToUse);
    }
    try {
      if (appIdToUse === '1089' || (/^\d+$/.test(appIdToUse) && appIdToUse.length <= 5)) {
        launchDerivLogin(appIdToUse);
        return;
      }
      await launchDerivPKCELogin(appIdToUse, window.location.origin);
    } catch (err: any) {
      setAuthError(err.message || 'Failed to launch OAuth');
    }
  };

  const handleOAuthSignUp = async () => {
    const appIdToUse = customAppId.trim() || DEFAULT_APP_ID;
    setAuth({ appId: appIdToUse });
    if (typeof window !== 'undefined') {
      localStorage.setItem('deriv_app_id', appIdToUse);
    }
    try {
      await launchDerivPKCESignUp(appIdToUse, window.location.origin);
    } catch (err: any) {
      setAuthError(err.message || 'Failed to launch Sign Up');
    }
  };

  const currentAccount = auth.activeAccount;
  const isVirtual = currentAccount?.isVirtual ?? (
    currentAccount?.account_type === 'demo' ||
    currentAccount?.account.startsWith('DOT') ||
    currentAccount?.account.startsWith('VR') ||
    false
  );

  const displayBalance = balance !== null
    ? Number(balance)
    : Number(currentAccount?.balance ?? 0);

  return (
    <>
      {/* Header Button / Account Badge */}
      {auth.isLoggedIn && currentAccount ? (
        <div className="relative">
          <button
            onClick={() => setIsDropdownOpen(!isDropdownOpen)}
            className={`flex items-center gap-2 px-2.5 py-1 sm:py-1.5 rounded border transition-all text-left font-mono text-[11px] sm:text-xs cursor-pointer ${
              isVirtual
                ? 'bg-[#ffb000]/10 border-[#ffb000]/30 hover:border-[#ffb000]/60 text-[#ffb000]'
                : 'bg-[#00ff9c]/10 border-[#00ff9c]/30 hover:border-[#00ff9c]/60 text-[#00ff9c]'
            }`}
          >
            <span className={`px-1.5 py-0.5 rounded text-[9px] font-extrabold uppercase ${
              isVirtual ? 'bg-[#ffb000]/20 text-[#ffb000]' : 'bg-[#00ff9c]/20 text-[#00ff9c]'
            }`}>
              {isVirtual ? 'DEMO' : 'REAL'}
            </span>
            <span className="font-bold text-[#e4e4e7] hidden sm:inline">
              {currentAccount.account}
            </span>
            <span className="font-semibold tabular-nums text-[#e4e4e7]">
              ${(Number.isFinite(displayBalance) ? displayBalance : 0).toFixed(2)}
            </span>
            <ChevronDown size={14} className="text-[#a1a1aa]" />
          </button>

          {/* Account Switcher Dropdown */}
          {isDropdownOpen && (
            <div className="absolute right-0 mt-1.5 w-64 bg-[#111114] border border-[#27272a] rounded-lg shadow-2xl p-2.5 z-50 font-mono text-xs space-y-2">
              <div className="flex items-center justify-between px-1 pb-1.5 border-b border-[#27272a]">
                <span className="text-[10px] uppercase text-[#a1a1aa] font-bold tracking-wider">
                  Accounts
                </span>
                <button
                  onClick={() => setIsDropdownOpen(false)}
                  className="text-[#71717a] hover:text-[#e4e4e7] cursor-pointer"
                >
                  <X size={13} />
                </button>
              </div>

              {accountAddingToken && (
                <div className="bg-black/50 border border-[#27272a] p-2 rounded space-y-1.5">
                  <div className="flex items-center justify-between text-[10px]">
                    <span className="font-bold text-[#e4e4e7]">{accountAddingToken.account} Token</span>
                    <button
                      type="button"
                      onClick={() => {
                        setAccountAddingToken(null);
                        setSubTokenError(null);
                      }}
                      className="text-[#71717a] hover:text-white"
                    >
                      <X size={11} />
                    </button>
                  </div>
                  <div className="flex gap-1">
                    <input
                      type="password"
                      value={tokenForAccountInput}
                      onChange={(e) => setTokenForAccountInput(e.target.value)}
                      placeholder="Paste token..."
                      className="flex-1 min-w-0 bg-[#18181b] border border-[#3f3f46] text-[#00ff9c] px-2 py-1 rounded text-[10px] outline-none focus:border-[#00ff9c]"
                    />
                    <button
                      type="button"
                      onClick={() => handleAddTokenToAccount(accountAddingToken, tokenForAccountInput)}
                      disabled={!tokenForAccountInput.trim() || isValidatingSubToken}
                      className="bg-[#00ff9c] text-black px-2 py-1 rounded font-bold text-[10px] disabled:opacity-50"
                    >
                      {isValidatingSubToken ? '...' : 'OK'}
                    </button>
                  </div>
                  {subTokenError && <div className="text-[9px] text-[#ff4b4b]">{subTokenError}</div>}
                </div>
              )}

              <div className="max-h-44 overflow-y-auto space-y-1">
                {auth.accounts.map((acct) => {
                  const isAcctActive = currentAccount.account === acct.account;
                  const hasToken = Boolean((acct.token && acct.token.trim().length > 0) || settings.authMethod === 'oauth');

                  return (
                    <button
                      key={acct.account}
                      type="button"
                      onClick={() => {
                        if (hasToken) {
                          switchAccount(acct);
                          setIsDropdownOpen(false);
                        } else {
                          setAccountAddingToken(acct);
                          setSubTokenError(null);
                          setTokenForAccountInput('');
                        }
                      }}
                      className={`w-full flex items-center justify-between px-2 py-1.5 rounded text-left transition-all border cursor-pointer ${
                        isAcctActive
                          ? 'bg-white/10 border-[#00ff9c]/40 text-[#e4e4e7]'
                          : 'bg-black/20 border-transparent hover:border-[#27272a] text-[#a1a1aa]'
                      }`}
                    >
                      <div className="flex items-center gap-1.5">
                        <span className={`text-[9px] px-1 py-0.5 rounded font-bold ${
                          acct.isVirtual ? 'bg-[#ffb000]/20 text-[#ffb000]' : 'bg-[#00ff9c]/20 text-[#00ff9c]'
                        }`}>
                          {acct.isVirtual ? 'DEMO' : 'REAL'}
                        </span>
                        <span className="font-bold text-[11px]">{acct.account}</span>
                      </div>

                      {hasToken ? (
                        <div className="flex items-center gap-1">
                          {acct.balance !== undefined && (
                            <span className="text-[10px] tabular-nums text-[#e4e4e7]">
                              ${Number(acct.balance).toFixed(2)}
                            </span>
                          )}
                          {isAcctActive && <CheckCircle2 size={12} className="text-[#00ff9c]" />}
                        </div>
                      ) : (
                        <span className="text-[9px] text-[#ffb000] font-semibold">
                          + Token
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>

              <div className="pt-1.5 border-t border-[#27272a] flex items-center justify-between gap-2">
                <button
                  onClick={() => {
                    setIsDropdownOpen(false);
                    setIsModalOpen(true);
                  }}
                  className="text-[10px] text-[#a1a1aa] hover:text-[#e4e4e7] flex items-center gap-1 cursor-pointer"
                >
                  <LogIn size={11} />
                  Switch Login
                </button>
                <div className="flex items-center gap-2.5">
                  {isVirtual && (
                    <button
                      type="button"
                      onClick={() => {
                        window.dispatchEvent(new CustomEvent('deriv_topup_virtual'));
                      }}
                      title="Top-up Virtual Demo Account"
                      className="text-[10px] text-[#ffb000] hover:text-[#ffd060] flex items-center gap-1 font-semibold cursor-pointer"
                    >
                      <RefreshCw size={10} />
                      Top Up
                    </button>
                  )}
                  <button
                    onClick={() => {
                      logout();
                      setIsDropdownOpen(false);
                    }}
                    className="text-[10px] text-[#ff4b4b] hover:text-[#ff7b7b] flex items-center gap-1 font-semibold cursor-pointer"
                  >
                    <LogOut size={11} />
                    Logout
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      ) : (
        <button
          onClick={() => {
            setAuthError(null);
            setIsModalOpen(true);
          }}
          disabled={isExchangingCode}
          className="flex items-center gap-1.5 bg-[#ff444f] hover:bg-[#ff555e] text-white px-3 py-1.5 rounded font-mono font-bold text-[11px] sm:text-xs transition-colors shrink-0 cursor-pointer"
        >
          {isExchangingCode ? <Loader2 size={13} className="animate-spin" /> : <LogIn size={13} strokeWidth={2.5} />}
          <span>{isExchangingCode ? 'Signing in...' : 'Log in'}</span>
        </button>
      )}

      {/* Deriv Login Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-xs flex items-center justify-center p-3">
          <div className="bg-[#111114] border border-[#27272a] w-full max-w-sm p-4 relative rounded-xl shadow-2xl font-mono text-xs space-y-3.5">
            <div className="flex items-center justify-between">
              <span className="font-bold text-xs text-[#e4e4e7] uppercase tracking-wider">
                Deriv Login
              </span>
              <button
                onClick={() => setIsModalOpen(false)}
                className="text-[#71717a] hover:text-[#e4e4e7] cursor-pointer"
              >
                <X size={16} />
              </button>
            </div>

            {/* Mode Switcher */}
            <div className="grid grid-cols-2 gap-1 bg-black/50 p-1 rounded-lg border border-[#27272a]">
              <button
                type="button"
                onClick={() => {
                  setActiveTab('oauth');
                  setAuthError(null);
                }}
                className={`py-1.5 rounded text-[11px] font-bold transition-all cursor-pointer ${
                  activeTab === 'oauth'
                    ? 'bg-[#ff444f] text-white'
                    : 'text-[#a1a1aa] hover:text-[#e4e4e7]'
                }`}
              >
                Deriv OAuth
              </button>
              <button
                type="button"
                onClick={() => {
                  setActiveTab('pat');
                  setAuthError(null);
                }}
                className={`py-1.5 rounded text-[11px] font-bold transition-all cursor-pointer ${
                  activeTab === 'pat'
                    ? 'bg-[#00ff9c] text-black'
                    : 'text-[#a1a1aa] hover:text-[#e4e4e7]'
                }`}
              >
                API Token
              </button>
            </div>

            {isExchangingCode && (
              <div className="bg-[#18181b] border border-[#27272a] p-2.5 rounded flex items-center gap-2 text-[11px] text-[#e4e4e7]">
                <Loader2 size={14} className="animate-spin text-[#00ff9c]" />
                <span>Completing Deriv OAuth sign-in...</span>
              </div>
            )}

            {patSuccessMsg && (
              <div className="bg-[#00ff9c]/10 border border-[#00ff9c]/40 p-2 rounded flex items-center gap-2 text-[11px] text-[#00ff9c]">
                <CheckCircle2 size={14} />
                <span>{patSuccessMsg}</span>
              </div>
            )}

            {authError && (
              <div className="bg-[#ff444f]/10 border border-[#ff444f]/40 p-2 rounded flex items-center justify-between gap-2 text-[11px] text-[#ff444f]">
                <span className="break-words">{authError}</span>
                <button type="button" onClick={() => setAuthError(null)} className="shrink-0">
                  <X size={12} />
                </button>
              </div>
            )}

            {/* OPTION 1: DERIV OAUTH (PKCE) */}
            {activeTab === 'oauth' && (
              <div className="space-y-3">
                <button
                  type="button"
                  onClick={() => handleOAuthLogin()}
                  disabled={isExchangingCode}
                  className="w-full flex items-center justify-center gap-2 bg-[#ff444f] hover:bg-[#ff555e] text-white py-2.5 px-3 rounded-lg font-bold text-xs transition-all cursor-pointer shadow-md"
                >
                  <LogIn size={14} />
                  <span>Continue with Deriv</span>
                  <ExternalLink size={12} className="opacity-80" />
                </button>

                {!/^\d+$/.test(customAppId) && (
                  <button
                    type="button"
                    onClick={handleOAuthSignUp}
                    disabled={isExchangingCode}
                    className="w-full flex items-center justify-center gap-1.5 bg-[#18181b] hover:bg-[#27272a] border border-[#27272a] text-[#e4e4e7] py-2 px-3 rounded-lg font-semibold text-[11px] transition-all cursor-pointer"
                  >
                    <UserPlus size={13} />
                    <span>Create Deriv Account</span>
                  </button>
                )}

                <div className="flex items-center justify-between gap-2 pt-0.5">
                  <span className="text-[10px] text-[#71717a] uppercase">Client / App ID</span>
                  <input
                    type="text"
                    value={customAppId}
                    onChange={(e) => setCustomAppId(e.target.value.trim())}
                    placeholder="1089"
                    className="w-40 bg-black/50 border border-[#27272a] text-[#e4e4e7] px-2 py-1 rounded text-[11px] text-right outline-none focus:border-[#ff444f]"
                  />
                </div>
              </div>
            )}

            {/* OPTION 2: API TOKEN / PAT */}
            {activeTab === 'pat' && (
              <div className="space-y-2.5">
                <div className="bg-[#00ff9c]/5 border border-[#00ff9c]/20 p-2 rounded text-[10px] text-[#a1a1aa] leading-relaxed">
                  <span className="text-[#00ff9c] font-bold">Direct Token Auth:</span> Paste a Deriv API token with Read + Trade scopes.
                </div>

                <div className="relative flex items-center">
                  <input
                    type={showPatToken ? 'text' : 'password'}
                    value={patInput}
                    onChange={(e) => {
                      setPatInput(e.target.value);
                      if (authError) setAuthError(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        validateAndLoginWithPAT(patInput, customAppId);
                      }
                    }}
                    placeholder="Paste Deriv API Token"
                    className="w-full bg-black/60 border border-[#27272a] text-[#00ff9c] px-3 py-2 pr-8 outline-none rounded-lg font-mono text-xs focus:border-[#00ff9c]"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPatToken(!showPatToken)}
                    className="absolute right-2.5 text-[#71717a] hover:text-[#e4e4e7] cursor-pointer"
                  >
                    {showPatToken ? <EyeOff size={13} /> : <Eye size={13} />}
                  </button>
                </div>

                <div className="flex items-center justify-between gap-2">
                  <a
                    href="https://app.deriv.com/account/api-token"
                    target="_blank"
                    rel="noreferrer"
                    className="text-[10px] text-[#38bdf8] hover:underline flex items-center gap-1"
                  >
                    <span>Get Token (Check Read + Trade)</span>
                    <ExternalLink size={10} />
                  </a>
                </div>

                <button
                  type="button"
                  onClick={() => validateAndLoginWithPAT(patInput, customAppId)}
                  disabled={!patInput.trim() || isValidatingPAT}
                  className="w-full flex items-center justify-center gap-1.5 bg-[#00ff9c] hover:bg-[#00ff9c]/90 disabled:opacity-50 text-black py-2 px-3 rounded-lg font-bold text-xs transition-all cursor-pointer"
                >
                  {isValidatingPAT ? <Loader2 size={14} className="animate-spin" /> : <Zap size={14} />}
                  <span>Connect</span>
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
