import { create } from 'zustand';
import {
  DerivAccount,
  DEFAULT_APP_ID,
  getAuthInfo,
  getActiveLoginId,
  setActiveLoginId,
  setAccountType,
  clearAllAuthData,
} from '../utils/derivAuth';

import {
  ALL_MARKET_SYMBOLS,
  EvenOddMode,
  SYNTHETIC_MARKET_CATALOG,
  StrategyType,
} from '../utils/marketCatalog';

export type { DerivAccount, StrategyType, EvenOddMode };
export { ALL_MARKET_SYMBOLS, SYNTHETIC_MARKET_CATALOG };

export interface MarketData {
  symbol: string;
  name: string;
  currentPrice: number;
  currentDigit: number;
  streak: number;
  evenStreak: number;
  oddStreak: number;
  streakHistory: number[];
  dCirclesTickCount?: number;
  dCirclesMostDigits?: number[];
  dCirclesLeastDigits?: number[];
}

export interface Trade {
  id: string;
  timestamp: number;
  market: string;
  contractId: number;
  buyPrice: number;
  result: 'won' | 'lost' | 'pending';
  pnl: number;
  entryTick?: string;
  exitTick?: string;
  entryDigit?: number;
  exitDigit?: number;
  contractType?: string;
}

export interface TradingSession {
  id: string;
  timestamp: number;
  pnl: number;
  wins: number;
  losses: number;
  tradeLog: Trade[];
}

export interface Settings {
  apiToken: string;
  appId?: string;
  authMethod?: 'oauth' | 'pat';
  activeAccountId?: string;
  accountCurrency?: string;
  globalStake: number;
  targetStreak: number;
  takeProfit: number;
  stopLoss: number;
  useSchedule: boolean;
  startTime: string;
  stopTime: string;
  strategy: StrategyType;
  evenOddMode: EvenOddMode;
  autoRotateTop3Over1?: boolean;
  selectedMarkets: string[]; // Explicit list of enabled symbols to trade on
  subscribedMarkets: string[]; // Explicit list of indices subscribed for live tick streaming
}

export interface AutoRotateMarketSummary {
  symbol: string;
  shortName: string;
  maxDrawdown: number;
  netPnL: number;
  riskScore: number;
  riskTier: string;
  tickCount: number;
}

export interface AutoRotateInfo {
  lastEvaluatedAt: number | null;
  lastRotatedAt: number | null;
  seededCount: number;
  totalCount: number;
  top3: string[];
  topMarkets: AutoRotateMarketSummary[];
}

export interface AuthState {
  isLoggedIn: boolean;
  activeAccount: DerivAccount | null;
  accounts: DerivAccount[];
  appId: string;
  userName?: string;
  userEmail?: string;
}

interface AppState {
  connectionStatus: 'disconnected' | 'connected';
  setConnectionStatus: (status: 'disconnected' | 'connected') => void;
  balance: number | null;
  setBalance: (balance: number) => void;
  settings: Settings;
  setSettings: (settings: Partial<Settings>) => void;
  toggleMarketSelection: (symbol: string) => void;
  setSelectedMarkets: (symbols: string[]) => void;
  toggleSubscribedMarket: (symbol: string) => void;
  setSubscribedMarkets: (symbols: string[]) => void;
  dCirclesSymbol: string;
  setDCirclesSymbol: (symbol: string) => void;
  autoRotateInfo: AutoRotateInfo;
  setAutoRotateInfo: (info: Partial<AutoRotateInfo>) => void;
  auth: AuthState;
  setAuth: (auth: Partial<AuthState>) => void;
  switchAccount: (account: DerivAccount) => void;
  logout: () => void;
  updateFromDerivAuth: (info: any) => void;
  isRunning: boolean;
  setIsRunning: (isRunning: boolean) => void;
  markets: Record<string, MarketData>;
  updateMarket: (symbol: string, data: Partial<MarketData>) => void;
  tradeLog: Trade[];
  addTrade: (trade: Trade) => void;
  updateTrade: (id: string, trade: Partial<Trade>) => void;
  sessionPnL: number;
  wins: number;
  losses: number;
  maxConsecutiveLosses: number;
  currentConsecutiveLosses: number;
  digitDistribution: number[];
  incrementDigit: (digit: number) => void;
  pastSessions: TradingSession[];
  saveAndResetSession: () => void;
  deleteSession: (id: string) => void;
  bulkUpdateMarkets: (updates: Record<string, Partial<MarketData>>) => void;
  setTradeLog: (trades: Trade[]) => void;
  lastLostSymbol: string | null;
  setLastLostSymbol: (symbol: string | null) => void;
  isWaitingForRecovery: boolean;
  setIsWaitingForRecovery: (isWaiting: boolean) => void;
  currentStake: number;
  setCurrentStake: (stake: number) => void;
}

// Hydrate stored accounts, auth_info, and active account from localStorage
const getInitialAuth = (): AuthState => {
  if (typeof window === 'undefined') {
    return {
      isLoggedIn: false,
      activeAccount: null,
      accounts: [],
      appId: DEFAULT_APP_ID
    };
  }

  try {
    const rawAccounts = localStorage.getItem('deriv_accounts');
    const rawActive = localStorage.getItem('deriv_active_account');
    const activeLoginId = getActiveLoginId();
    const authInfo = getAuthInfo(true);
    const storedAppId =
      localStorage.getItem('oauth_client_id') ||
      localStorage.getItem('deriv_app_id') ||
      DEFAULT_APP_ID;
    const manualToken = localStorage.getItem('deriv_api_token') || '';

    const accounts: DerivAccount[] = rawAccounts ? JSON.parse(rawAccounts) : [];
    let activeAccount: DerivAccount | null = rawActive ? JSON.parse(rawActive) : null;

    if (!activeAccount && accounts.length > 0) {
      activeAccount =
        (activeLoginId ? accounts.find(a => (a.account_id || a.account) === activeLoginId) : undefined) ||
        accounts.find(a => a.isVirtual) ||
        accounts[0];
    } else if (!activeAccount && manualToken) {
      activeAccount = {
        account: 'Manual Token',
        token: manualToken,
        currency: 'USD',
        isVirtual: false
      };
    }

    if (activeAccount && authInfo?.access_token && !activeAccount.token) {
      activeAccount = { ...activeAccount, token: authInfo.access_token };
    }

    return {
      isLoggedIn: !!(activeAccount?.token || authInfo?.access_token),
      activeAccount,
      accounts,
      appId: storedAppId
    };
  } catch (e) {
    return {
      isLoggedIn: false,
      activeAccount: null,
      accounts: [],
      appId: DEFAULT_APP_ID
    };
  }
};

const initialAuth = getInitialAuth();
const initialOAuthInfo = typeof window !== 'undefined' ? getAuthInfo(true) : null;

export const useStore = create<AppState>()((set) => ({
  connectionStatus: 'disconnected',
  setConnectionStatus: (status) => set({ connectionStatus: status }),
  balance: initialAuth.activeAccount?.balance ?? null,
  setBalance: (balance) => set({ balance }),
  auth: initialAuth,
  setAuth: (newAuth) =>
    set((state) => {
      const mergedAuth = { ...state.auth, ...newAuth };
      if (typeof window !== 'undefined') {
        if (mergedAuth.accounts) localStorage.setItem('deriv_accounts', JSON.stringify(mergedAuth.accounts));
        if (mergedAuth.activeAccount) {
          localStorage.setItem('deriv_active_account', JSON.stringify(mergedAuth.activeAccount));
          const loginId = mergedAuth.activeAccount.account_id || mergedAuth.activeAccount.account;
          if (loginId && loginId !== 'Deriv' && loginId !== 'Manual Token') {
            setActiveLoginId(loginId);
            setAccountType(mergedAuth.activeAccount.isVirtual ? 'demo' : 'real');
          }
        }
        if (mergedAuth.appId) localStorage.setItem('deriv_app_id', mergedAuth.appId);
      }
      return { auth: mergedAuth };
    }),
  switchAccount: (account: DerivAccount) =>
    set((state) => {
      const loginId = account.account_id || account.account;
      const authInfo = typeof window !== 'undefined' ? getAuthInfo(true) : null;
      const resolvedToken = account.token || authInfo?.access_token || state.settings.apiToken;
      const resolvedAccount: DerivAccount = { ...account, token: resolvedToken };
      const isOAuthAccount = Boolean(account.account_type || authInfo?.access_token);

      if (typeof window !== 'undefined') {
        localStorage.setItem('deriv_active_account', JSON.stringify(resolvedAccount));
        if (loginId) {
          setActiveLoginId(loginId);
          setAccountType(account.isVirtual ? 'demo' : 'real');
        }
      }
      const newSettings: Settings = {
        ...state.settings,
        apiToken: resolvedToken,
        authMethod: isOAuthAccount ? 'oauth' : 'pat',
        activeAccountId: loginId,
        accountCurrency: account.currency || 'USD',
      };
      window.dispatchEvent(new CustomEvent('bot_settings_changed', { detail: newSettings }));
      return {
        auth: {
          ...state.auth,
          activeAccount: resolvedAccount,
          isLoggedIn: true
        },
        settings: newSettings,
        balance: account.balance !== undefined ? account.balance : state.balance
      };
    }),
  logout: () =>
    set((state) => {
      clearAllAuthData();
      const newSettings: Settings = {
        ...state.settings,
        apiToken: '',
        authMethod: undefined,
        activeAccountId: undefined,
      };
      window.dispatchEvent(new CustomEvent('bot_settings_changed', { detail: newSettings }));
      return {
        auth: {
          isLoggedIn: false,
          activeAccount: null,
          accounts: [],
          appId: state.auth.appId,
          userName: undefined,
          userEmail: undefined
        },
        settings: newSettings,
        balance: null,
        isRunning: false
      };
    }),
  updateFromDerivAuth: (info: any) =>
    set((state) => {
      const newAuth = { ...state.auth };
      if (info.fullname) newAuth.userName = info.fullname;
      if (info.email) newAuth.userEmail = info.email;

      // Update active account details if matched
      if (newAuth.activeAccount && info.loginid) {
        newAuth.activeAccount = {
          ...newAuth.activeAccount,
          account: info.loginid,
          currency: info.currency || newAuth.activeAccount.currency,
          isVirtual: info.is_virtual === 1,
          balance: info.balance
        };
      }

      return {
        auth: newAuth,
        balance: info.balance !== undefined ? info.balance : state.balance
      };
    }),
  settings: {
    apiToken: initialAuth.activeAccount?.token || initialOAuthInfo?.access_token || '',
    appId: initialAuth.appId || DEFAULT_APP_ID,
    authMethod: (initialOAuthInfo?.access_token || initialAuth.activeAccount?.account_type) ? 'oauth' : 'pat',
    activeAccountId: initialAuth.activeAccount?.account_id || initialAuth.activeAccount?.account || (typeof window !== 'undefined' ? getActiveLoginId() || undefined : undefined),
    accountCurrency: initialAuth.activeAccount?.currency || 'USD',
    globalStake: 1,
    targetStreak: 3,
    takeProfit: 10,
    stopLoss: 20,
    useSchedule: false,
    startTime: '08:00',
    stopTime: '17:00',
    strategy: 'DIGIT_OVER',
    evenOddMode: 'reversal',
    autoRotateTop3Over1:
      typeof window !== 'undefined' && localStorage.getItem('deriv_auto_rotate_over1') === 'true',
    selectedMarkets: (() => {
      if (typeof window !== 'undefined') {
        try {
          const saved = localStorage.getItem('deriv_selected_markets');
          if (saved) {
            const parsed = JSON.parse(saved);
            if (Array.isArray(parsed)) return parsed;
          }
        } catch (e) {}
      }
      return [...ALL_MARKET_SYMBOLS];
    })(),
    subscribedMarkets: (() => {
      if (typeof window !== 'undefined') {
        try {
          const saved = localStorage.getItem('deriv_subscribed_markets');
          if (saved) {
            const parsed = JSON.parse(saved);
            if (Array.isArray(parsed)) return parsed;
          }
        } catch (e) {}
      }
      return [...ALL_MARKET_SYMBOLS];
    })()
  },
  setSettings: (newSettings) =>
    set((state) => {
      const legacyPayload = newSettings as Partial<Settings> & { selectedMarket?: string };
      const normalizedStrategy: StrategyType =
        (newSettings.strategy as string) === 'RISE_FALL'
          ? 'EVEN_ODD'
          : newSettings.strategy === 'DCIRCLES_EVEN_ODD'
            ? 'DCIRCLES_EVEN_ODD'
            : newSettings.strategy === 'EVEN_ODD'
              ? 'EVEN_ODD'
              : newSettings.strategy === 'DIGIT_OVER'
                ? 'DIGIT_OVER'
                : (state.settings.strategy || 'DIGIT_OVER');
      const normalizedSelectedMarkets = Array.isArray(newSettings.selectedMarkets)
        ? newSettings.selectedMarkets
        : legacyPayload.selectedMarket &&
            legacyPayload.selectedMarket !== 'ALL' &&
            legacyPayload.selectedMarket !== 'CUSTOM'
          ? [legacyPayload.selectedMarket]
          : state.settings.selectedMarkets;
      const { selectedMarket: _ignored, ...restNewSettings } = legacyPayload;
      const nextAutoRotate =
        normalizedStrategy !== 'DIGIT_OVER'
          ? false
          : newSettings.autoRotateTop3Over1 !== undefined
            ? Boolean(newSettings.autoRotateTop3Over1)
            : Boolean(state.settings.autoRotateTop3Over1);
      const merged: Settings = {
        ...state.settings,
        ...restNewSettings,
        strategy: normalizedStrategy,
        evenOddMode: newSettings.evenOddMode || state.settings.evenOddMode || 'reversal',
        autoRotateTop3Over1: nextAutoRotate,
        selectedMarkets: normalizedSelectedMarkets,
      };
      if (typeof window !== 'undefined') {
        localStorage.setItem('deriv_auto_rotate_over1', String(nextAutoRotate));
        if (Array.isArray(merged.selectedMarkets)) {
          localStorage.setItem('deriv_selected_markets', JSON.stringify(merged.selectedMarkets));
        }
        if (Array.isArray(merged.subscribedMarkets)) {
          localStorage.setItem('deriv_subscribed_markets', JSON.stringify(merged.subscribedMarkets));
        }
      }
      return {
        settings: merged,
        currentStake: state.isRunning ? state.currentStake : (merged.globalStake || 1),
      };
    }),
  toggleMarketSelection: (symbol) =>
    set((state) => {
      const current = state.settings.selectedMarkets ?? [...ALL_MARKET_SYMBOLS];
      const next = current.includes(symbol)
        ? current.filter((s) => s !== symbol)
        : [...current, symbol];
      const updated = {
        ...state.settings,
        selectedMarkets: next,
      };
      if (typeof window !== 'undefined') {
        localStorage.setItem('deriv_selected_markets', JSON.stringify(next));
        window.dispatchEvent(new CustomEvent('bot_settings_changed', { detail: updated }));
      }
      return { settings: updated };
    }),
  setSelectedMarkets: (symbols) =>
    set((state) => {
      const next = [...symbols];
      const updated = {
        ...state.settings,
        selectedMarkets: next,
      };
      if (typeof window !== 'undefined') {
        localStorage.setItem('deriv_selected_markets', JSON.stringify(next));
        window.dispatchEvent(new CustomEvent('bot_settings_changed', { detail: updated }));
      }
      return { settings: updated };
    }),
  toggleSubscribedMarket: (symbol) =>
    set((state) => {
      const current = state.settings.subscribedMarkets ?? [...ALL_MARKET_SYMBOLS];
      const isRemoving = current.includes(symbol);
      const next = isRemoving
        ? current.filter((s) => s !== symbol)
        : [...current, symbol];
      const updated = {
        ...state.settings,
        subscribedMarkets: next,
      };
      const updatedMarkets = { ...state.markets };
      if (isRemoving && updatedMarkets[symbol]) {
        updatedMarkets[symbol] = {
          symbol,
          name: updatedMarkets[symbol].name,
          currentPrice: 0,
          currentDigit: 0,
          streak: 0,
          evenStreak: 0,
          oddStreak: 0,
          streakHistory: []
        };
      }
      if (typeof window !== 'undefined') {
        localStorage.setItem('deriv_subscribed_markets', JSON.stringify(next));
        window.dispatchEvent(new CustomEvent('bot_settings_changed', { detail: updated }));
      }
      return { settings: updated, markets: updatedMarkets };
    }),
  setSubscribedMarkets: (symbols) =>
    set((state) => {
      const nextSet = new Set(symbols);
      const next = ALL_MARKET_SYMBOLS.filter((sym) => nextSet.has(sym));
      const updated = {
        ...state.settings,
        subscribedMarkets: next,
      };
      const updatedMarkets = { ...state.markets };
      for (const sym of Object.keys(updatedMarkets)) {
        if (!nextSet.has(sym)) {
          updatedMarkets[sym] = {
            symbol: sym,
            name: updatedMarkets[sym].name,
            currentPrice: 0,
            currentDigit: 0,
            streak: 0,
            evenStreak: 0,
            oddStreak: 0,
            streakHistory: []
          };
        }
      }
      if (typeof window !== 'undefined') {
        localStorage.setItem('deriv_subscribed_markets', JSON.stringify(next));
        window.dispatchEvent(new CustomEvent('bot_settings_changed', { detail: updated }));
      }
      return { settings: updated, markets: updatedMarkets };
    }),
  dCirclesSymbol: (() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('deriv_dcircles_symbol');
      if (saved && ALL_MARKET_SYMBOLS.includes(saved as any)) return saved;
    }
    return 'R_100';
  })(),
  setDCirclesSymbol: (symbol) =>
    set(() => {
      if (typeof window !== 'undefined') {
        localStorage.setItem('deriv_dcircles_symbol', symbol);
      }
      return { dCirclesSymbol: symbol };
    }),
  autoRotateInfo: {
    lastEvaluatedAt: null,
    lastRotatedAt: null,
    seededCount: 0,
    totalCount: ALL_MARKET_SYMBOLS.length,
    top3: [],
    topMarkets: [],
  },
  setAutoRotateInfo: (info) =>
    set((state) => ({
      autoRotateInfo: { ...state.autoRotateInfo, ...info },
    })),
  isRunning: false,
  setIsRunning: (run) => set({ isRunning: run }),
  markets: {
    'R_10': { symbol: 'R_10', name: 'Volatility 10 Index', currentPrice: 0, currentDigit: 0, streak: 0, evenStreak: 0, oddStreak: 0, streakHistory: [] },
    'R_25': { symbol: 'R_25', name: 'Volatility 25 Index', currentPrice: 0, currentDigit: 0, streak: 0, evenStreak: 0, oddStreak: 0, streakHistory: [] },
    'R_50': { symbol: 'R_50', name: 'Volatility 50 Index', currentPrice: 0, currentDigit: 0, streak: 0, evenStreak: 0, oddStreak: 0, streakHistory: [] },
    'R_75': { symbol: 'R_75', name: 'Volatility 75 Index', currentPrice: 0, currentDigit: 0, streak: 0, evenStreak: 0, oddStreak: 0, streakHistory: [] },
    'R_100': { symbol: 'R_100', name: 'Volatility 100 Index', currentPrice: 0, currentDigit: 0, streak: 0, evenStreak: 0, oddStreak: 0, streakHistory: [] },
    '1HZ10V': { symbol: '1HZ10V', name: 'Volatility 10 (1s) Index', currentPrice: 0, currentDigit: 0, streak: 0, evenStreak: 0, oddStreak: 0, streakHistory: [] },
    '1HZ25V': { symbol: '1HZ25V', name: 'Volatility 25 (1s) Index', currentPrice: 0, currentDigit: 0, streak: 0, evenStreak: 0, oddStreak: 0, streakHistory: [] },
    '1HZ50V': { symbol: '1HZ50V', name: 'Volatility 50 (1s) Index', currentPrice: 0, currentDigit: 0, streak: 0, evenStreak: 0, oddStreak: 0, streakHistory: [] },
    '1HZ75V': { symbol: '1HZ75V', name: 'Volatility 75 (1s) Index', currentPrice: 0, currentDigit: 0, streak: 0, evenStreak: 0, oddStreak: 0, streakHistory: [] },
    '1HZ100V': { symbol: '1HZ100V', name: 'Volatility 100 (1s) Index', currentPrice: 0, currentDigit: 0, streak: 0, evenStreak: 0, oddStreak: 0, streakHistory: [] },
    'JD10': { symbol: 'JD10', name: 'Jump 10 Index', currentPrice: 0, currentDigit: 0, streak: 0, evenStreak: 0, oddStreak: 0, streakHistory: [] },
    'JD25': { symbol: 'JD25', name: 'Jump 25 Index', currentPrice: 0, currentDigit: 0, streak: 0, evenStreak: 0, oddStreak: 0, streakHistory: [] },
    'JD50': { symbol: 'JD50', name: 'Jump 50 Index', currentPrice: 0, currentDigit: 0, streak: 0, evenStreak: 0, oddStreak: 0, streakHistory: [] },
    'JD75': { symbol: 'JD75', name: 'Jump 75 Index', currentPrice: 0, currentDigit: 0, streak: 0, evenStreak: 0, oddStreak: 0, streakHistory: [] },
    'JD100': { symbol: 'JD100', name: 'Jump 100 Index', currentPrice: 0, currentDigit: 0, streak: 0, evenStreak: 0, oddStreak: 0, streakHistory: [] },
    'RDBEAR': { symbol: 'RDBEAR', name: 'Bear Market Index', currentPrice: 0, currentDigit: 0, streak: 0, evenStreak: 0, oddStreak: 0, streakHistory: [] },
    'RDBULL': { symbol: 'RDBULL', name: 'Bull Market Index', currentPrice: 0, currentDigit: 0, streak: 0, evenStreak: 0, oddStreak: 0, streakHistory: [] }
  },
  updateMarket: (symbol, data) =>
    set((state) => ({
      markets: {
        ...state.markets,
        [symbol]: { ...state.markets[symbol], ...data },
      },
    })),
  bulkUpdateMarkets: (updates) => 
    set((state) => {
      const newMarkets = { ...state.markets };
      for (const [symbol, data] of Object.entries(updates)) {
        newMarkets[symbol] = { ...newMarkets[symbol], ...data };
      }
      return { markets: newMarkets };
    }),
  setTradeLog: (trades) => set({ tradeLog: trades }),
  tradeLog: [],
  addTrade: (trade) =>
    set((state) => {
      let newWins = state.wins;
      let newLosses = state.losses;
      let newCurrentConsecutiveLosses = state.currentConsecutiveLosses;
      let newMaxConsecutiveLosses = state.maxConsecutiveLosses;
      
      if (trade.result === 'won') {
          newWins++;
          newCurrentConsecutiveLosses = 0;
      } else if (trade.result === 'lost') {
          newLosses++;
          newCurrentConsecutiveLosses++;
          if (newCurrentConsecutiveLosses > newMaxConsecutiveLosses) {
              newMaxConsecutiveLosses = newCurrentConsecutiveLosses;
          }
      }
      
      const newTrades = [trade, ...state.tradeLog];
      return { 
          tradeLog: newTrades,
          wins: newWins,
          losses: newLosses,
          currentConsecutiveLosses: newCurrentConsecutiveLosses,
          maxConsecutiveLosses: newMaxConsecutiveLosses,
          sessionPnL: state.sessionPnL + trade.pnl 
      };
    }),
  updateTrade: (id, updatedFields) =>
    set((state) => {
      let newWins = state.wins;
      let newLosses = state.losses;
      let newCurrentConsecutiveLosses = state.currentConsecutiveLosses;
      let newMaxConsecutiveLosses = state.maxConsecutiveLosses;
      let addedPnL = 0;

      const newTrades = state.tradeLog.map(trade => {
        if (trade.id === id) {
          if (trade.result === 'pending' && updatedFields.result) {
            if (updatedFields.result === 'won') {
                newWins++;
                newCurrentConsecutiveLosses = 0;
            } else if (updatedFields.result === 'lost') {
                newLosses++;
                newCurrentConsecutiveLosses++;
                if (newCurrentConsecutiveLosses > newMaxConsecutiveLosses) {
                    newMaxConsecutiveLosses = newCurrentConsecutiveLosses;
                }
            }
            if (updatedFields.pnl !== undefined) {
                addedPnL = updatedFields.pnl;
            }
          }
          return { ...trade, ...updatedFields };
        }
        return trade;
      });

      return {
        tradeLog: newTrades,
        wins: newWins,
        losses: newLosses,
        currentConsecutiveLosses: newCurrentConsecutiveLosses,
        maxConsecutiveLosses: newMaxConsecutiveLosses,
        sessionPnL: state.sessionPnL + addedPnL
      };
    }),
  sessionPnL: 0,
  wins: 0,
  losses: 0,
  maxConsecutiveLosses: 0,
  currentConsecutiveLosses: 0,
  digitDistribution: Array(10).fill(0),
  incrementDigit: (digit) =>
    set((state) => {
      const newDist = [...state.digitDistribution];
      if (digit >= 0 && digit <= 9) {
        newDist[digit] = (newDist[digit] || 0) + 1;
      }
      return { digitDistribution: newDist };
    }),
  pastSessions: [],
  saveAndResetSession: () => set((state) => {
    if (state.tradeLog.length === 0) {
      return { sessionPnL: 0, wins: 0, losses: 0, maxConsecutiveLosses: 0, currentConsecutiveLosses: 0, digitDistribution: Array(10).fill(0) };
    }
    
    const newSession: TradingSession = {
      id: Date.now().toString(),
      timestamp: Date.now(),
      pnl: state.sessionPnL,
      wins: state.wins,
      losses: state.losses,
      tradeLog: [...state.tradeLog]
    };

    return { 
      pastSessions: [newSession, ...state.pastSessions],
      sessionPnL: 0, 
      wins: 0, 
      losses: 0, 
      maxConsecutiveLosses: 0,
      currentConsecutiveLosses: 0,
      tradeLog: [], 
      digitDistribution: Array(10).fill(0) 
    };
  }),
  deleteSession: (id) => set((state) => ({ pastSessions: state.pastSessions.filter(s => s.id !== id) })),
  lastLostSymbol: null,
  setLastLostSymbol: (symbol) => set({ lastLostSymbol: symbol }),
  isWaitingForRecovery: false,
  setIsWaitingForRecovery: (isWaiting) => set({ isWaitingForRecovery: isWaiting }),
  currentStake: 1,
  setCurrentStake: (stake) => set({ currentStake: stake }),
}));
