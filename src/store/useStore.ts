import { create } from 'zustand';
import { DerivAccount, DEFAULT_APP_ID } from '../utils/derivAuth';

export type { DerivAccount };

export type StrategyType = 'DIGIT_OVER' | 'RISE_FALL';

export interface CandleData {
  epoch: number;
  open: number;
  high: number;
  low: number;
  close: number;
  trend: 'bullish' | 'bearish' | 'neutral';
}

export interface MarketData {
  symbol: string;
  name: string;
  currentPrice: number;
  currentDigit: number;
  streak: number;
  streakHistory: number[];
  candleOpen?: number;
  candleHigh?: number;
  candleLow?: number;
  candleClose?: number;
  prevCandleOpen?: number;
  prevCandleClose?: number;
  prevCandleTrend?: 'bullish' | 'bearish' | 'neutral';
  candleTimeRemaining?: number;
  candleHistory?: CandleData[];
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

export const ALL_MARKET_SYMBOLS = [
  'R_10', 'R_25', 'R_50', 'R_75', 'R_100',
  '1HZ10V', '1HZ25V', '1HZ50V', '1HZ75V', '1HZ100V',
  'JD10', 'JD25', 'JD50', 'JD75', 'JD100',
  'RDBEAR', 'RDBULL'
] as const;

export interface Settings {
  apiToken: string;
  appId?: string;
  globalStake: number;
  targetStreak: number;
  takeProfit: number;
  stopLoss: number;
  useSchedule: boolean;
  startTime: string;
  stopTime: string;
  strategy: StrategyType;
  timeframe: number; // candle granularity in seconds (60, 120, 180, 300, 600, 900, 1800, 3600)
  tradeDuration: number;
  tradeDurationUnit: 'm' | 't' | 's';
  selectedMarket: string; // 'ALL' or specific symbol (legacy fallback)
  selectedMarkets: string[]; // Explicit list of enabled symbols to trade on
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
}

// Hydrate stored accounts and active account from localStorage
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
    const storedAppId = localStorage.getItem('deriv_app_id') || DEFAULT_APP_ID;
    const manualToken = localStorage.getItem('deriv_api_token') || '';

    const accounts: DerivAccount[] = rawAccounts ? JSON.parse(rawAccounts) : [];
    let activeAccount: DerivAccount | null = rawActive ? JSON.parse(rawActive) : null;

    if (!activeAccount && accounts.length > 0) {
      activeAccount = accounts.find(a => a.isVirtual) || accounts[0];
    } else if (!activeAccount && manualToken) {
      activeAccount = {
        account: 'Manual Token',
        token: manualToken,
        currency: 'USD',
        isVirtual: false
      };
    }

    return {
      isLoggedIn: !!activeAccount?.token,
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

export const useStore = create<AppState>()((set) => ({
  connectionStatus: 'disconnected',
  setConnectionStatus: (status) => set({ connectionStatus: status }),
  balance: null,
  setBalance: (balance) => set({ balance }),
  auth: initialAuth,
  setAuth: (newAuth) =>
    set((state) => {
      const mergedAuth = { ...state.auth, ...newAuth };
      if (typeof window !== 'undefined') {
        if (mergedAuth.accounts) localStorage.setItem('deriv_accounts', JSON.stringify(mergedAuth.accounts));
        if (mergedAuth.activeAccount) localStorage.setItem('deriv_active_account', JSON.stringify(mergedAuth.activeAccount));
        if (mergedAuth.appId) localStorage.setItem('deriv_app_id', mergedAuth.appId);
      }
      return { auth: mergedAuth };
    }),
  switchAccount: (account: DerivAccount) =>
    set((state) => {
      if (typeof window !== 'undefined') {
        localStorage.setItem('deriv_active_account', JSON.stringify(account));
      }
      const newSettings = { ...state.settings, apiToken: account.token };
      window.dispatchEvent(new CustomEvent('bot_settings_changed', { detail: newSettings }));
      return {
        auth: {
          ...state.auth,
          activeAccount: account,
          isLoggedIn: true
        },
        settings: newSettings
      };
    }),
  logout: () =>
    set((state) => {
      if (typeof window !== 'undefined') {
        localStorage.removeItem('deriv_accounts');
        localStorage.removeItem('deriv_active_account');
        localStorage.removeItem('deriv_api_token');
      }
      const newSettings = { ...state.settings, apiToken: '' };
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
    apiToken: initialAuth.activeAccount?.token || '',
    appId: initialAuth.appId || DEFAULT_APP_ID,
    globalStake: 1,
    targetStreak: 3,
    takeProfit: 10,
    stopLoss: 20,
    useSchedule: false,
    startTime: '08:00',
    stopTime: '17:00',
    strategy: 'DIGIT_OVER',
    timeframe: 60,
    tradeDuration: 1,
    tradeDurationUnit: 'm',
    selectedMarket: 'ALL',
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
    })()
  },
  setSettings: (newSettings) =>
    set((state) => {
      const merged = { ...state.settings, ...newSettings };
      if (typeof window !== 'undefined' && Array.isArray(merged.selectedMarkets)) {
        localStorage.setItem('deriv_selected_markets', JSON.stringify(merged.selectedMarkets));
      }
      return { settings: merged };
    }),
  toggleMarketSelection: (symbol) =>
    set((state) => {
      const current = state.settings.selectedMarkets ?? [...ALL_MARKET_SYMBOLS];
      const next = current.includes(symbol)
        ? current.filter((s) => s !== symbol)
        : [...current, symbol];
      const nextSelectedMarket =
        next.length === ALL_MARKET_SYMBOLS.length ? 'ALL' : next.length === 1 ? next[0] : 'CUSTOM';
      const updated = {
        ...state.settings,
        selectedMarkets: next,
        selectedMarket: nextSelectedMarket,
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
      const nextSelectedMarket =
        next.length === ALL_MARKET_SYMBOLS.length ? 'ALL' : next.length === 1 ? next[0] : 'CUSTOM';
      const updated = {
        ...state.settings,
        selectedMarkets: next,
        selectedMarket: nextSelectedMarket,
      };
      if (typeof window !== 'undefined') {
        localStorage.setItem('deriv_selected_markets', JSON.stringify(next));
        window.dispatchEvent(new CustomEvent('bot_settings_changed', { detail: updated }));
      }
      return { settings: updated };
    }),
  isRunning: false,
  setIsRunning: (run) => set({ isRunning: run }),
  markets: {
    'R_10': { symbol: 'R_10', name: 'Volatility 10 Index', currentPrice: 0, currentDigit: 0, streak: 0, streakHistory: [] },
    'R_25': { symbol: 'R_25', name: 'Volatility 25 Index', currentPrice: 0, currentDigit: 0, streak: 0, streakHistory: [] },
    'R_50': { symbol: 'R_50', name: 'Volatility 50 Index', currentPrice: 0, currentDigit: 0, streak: 0, streakHistory: [] },
    'R_75': { symbol: 'R_75', name: 'Volatility 75 Index', currentPrice: 0, currentDigit: 0, streak: 0, streakHistory: [] },
    'R_100': { symbol: 'R_100', name: 'Volatility 100 Index', currentPrice: 0, currentDigit: 0, streak: 0, streakHistory: [] },
    '1HZ10V': { symbol: '1HZ10V', name: 'Volatility 10 (1s) Index', currentPrice: 0, currentDigit: 0, streak: 0, streakHistory: [] },
    '1HZ25V': { symbol: '1HZ25V', name: 'Volatility 25 (1s) Index', currentPrice: 0, currentDigit: 0, streak: 0, streakHistory: [] },
    '1HZ50V': { symbol: '1HZ50V', name: 'Volatility 50 (1s) Index', currentPrice: 0, currentDigit: 0, streak: 0, streakHistory: [] },
    '1HZ75V': { symbol: '1HZ75V', name: 'Volatility 75 (1s) Index', currentPrice: 0, currentDigit: 0, streak: 0, streakHistory: [] },
    '1HZ100V': { symbol: '1HZ100V', name: 'Volatility 100 (1s) Index', currentPrice: 0, currentDigit: 0, streak: 0, streakHistory: [] },
    'JD10': { symbol: 'JD10', name: 'Jump 10 Index', currentPrice: 0, currentDigit: 0, streak: 0, streakHistory: [] },
    'JD25': { symbol: 'JD25', name: 'Jump 25 Index', currentPrice: 0, currentDigit: 0, streak: 0, streakHistory: [] },
    'JD50': { symbol: 'JD50', name: 'Jump 50 Index', currentPrice: 0, currentDigit: 0, streak: 0, streakHistory: [] },
    'JD75': { symbol: 'JD75', name: 'Jump 75 Index', currentPrice: 0, currentDigit: 0, streak: 0, streakHistory: [] },
    'JD100': { symbol: 'JD100', name: 'Jump 100 Index', currentPrice: 0, currentDigit: 0, streak: 0, streakHistory: [] },
    'RDBEAR': { symbol: 'RDBEAR', name: 'Bear Market Index', currentPrice: 0, currentDigit: 0, streak: 0, streakHistory: [] },
    'RDBULL': { symbol: 'RDBULL', name: 'Bull Market Index', currentPrice: 0, currentDigit: 0, streak: 0, streakHistory: [] }
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
  setIsWaitingForRecovery: (isWaiting) => set({ isWaitingForRecovery: isWaiting })
}));
