import { evaluateDCirclesSignal } from '../utils/dCirclesStrategy';
import { SYNTHETIC_MARKET_CATALOG } from '../utils/marketCatalog';
import { MarketBacktestResult, MarketTickSeries, runBacktestSuite } from '../utils/backtestEngine';

export type WorkerCommand = 
  | { type: 'INIT', settings: any }
  | { type: 'START', settings: any, sessionPnL: number }
  | { type: 'STOP' }
  | { type: 'UPDATE_SETTINGS', settings: any }
  | { type: 'TOPUP' };

const PUBLIC_WS_URL = 'wss://api.derivws.com/trading/v1/options/ws/public';
const HISTORY_SIZE = 20;
const DCIRCLES_WINDOW_SIZE = 5000;

interface MarketState {
  symbol: string;
  price: number;
  pipSize: number;
  digit: number;
  streak: number;
  evenStreak: number;
  oddStreak: number;
  history: Int8Array;
  historyIndex: number;
  ring5k: Uint8Array;
  ring5kLen: number;
  ring5kWriteIdx: number;
  digitCounts5k: number[];
  seeded5k: boolean;
  seeding5k: boolean;
  lastSeedEpoch: number | null;
}

const markets = [
  'R_10', 'R_25', 'R_50', 'R_75', 'R_100',
  '1HZ10V', '1HZ25V', '1HZ50V', '1HZ75V', '1HZ100V',
  'JD10', 'JD25', 'JD50', 'JD75', 'JD100',
  'RDBEAR', 'RDBULL'
];

const marketStates: Record<string, MarketState> = {};

markets.forEach(symbol => {
  marketStates[symbol] = {
    symbol,
    price: 0,
    pipSize: 4,
    digit: 0,
    streak: 0,
    evenStreak: 0,
    oddStreak: 0,
    history: new Int8Array(HISTORY_SIZE).fill(-1),
    historyIndex: 0,
    ring5k: new Uint8Array(DCIRCLES_WINDOW_SIZE),
    ring5kLen: 0,
    ring5kWriteIdx: 0,
    digitCounts5k: Array(10).fill(0),
    seeded5k: false,
    seeding5k: false,
    lastSeedEpoch: null
  };
});

// Separate sockets: public market stream (no auth needed) & trading/account socket (when logged in)
let publicWs: WebSocket | null = null;
let publicPingInterval: any = null;
let isSubscribedToMarkets = false;
const activeTickSymbols = new Set<string>();
let tickSubIds: Record<string, string> = {};
let historyReqIdToSymbol: Record<number, string> = {};
let pendingAutoTop3: { top3: string[]; topMarkets: any[] } | null = null;
let autoRotateInterval: any = null;
let lastSeededReadyEval = false;
const MAX_SEED_CONCURRENCY = 4;

let tradeWs: WebSocket | null = null;
let tradePingInterval: any = null;
let fallbackToDefaultAppId = false;
let isOtpSocket = false;
let isConnectingTrade = false;

let isRunning = false;
let currentSettings: any = null;
let currentBalance = 0;

let globalCurrentStake = 1;
let isTradeActive = false;
let sessionPnL = 0;
let lastLostSymbol: string | null = null;
let cumulativeLoss = 0;
let stopScheduledAndWaitingForRecovery = false;
let deadlockTimeoutId: any = null;
let lastTradeAttemptTime = 0;

let expectedCallbacks = 0;
let batchPnL = 0;
let batchSymbol: string | null = null;

let pendingUpdates: Record<string, any> = {};
let batchTimeout: any = null;

let pendingContracts: Record<number, { customId: string, symbol: string, stake: number, timestamp: number }> = {};
let reqIdToSymbol: Record<number, string> = {};
let reqIdCounter = Math.floor(Date.now() / 1000);

function emit(event: any) {
  self.postMessage(event);
}

self.onerror = (err) => {
  console.error('[Worker] Unhandled Error:', err);
  emit({ type: 'ERROR', message: 'Worker internal error' });
};

let lastCheckedMinute: string | null = null;
setInterval(() => {
  if (!currentSettings || !currentSettings.useSchedule) return;

  const now = new Date();
  const hh = now.getHours().toString().padStart(2, '0');
  const mm = now.getMinutes().toString().padStart(2, '0');
  const current = `${hh}:${mm}`;

  if (lastCheckedMinute !== current) {
    lastCheckedMinute = current;

    if (currentSettings.startTime && current === currentSettings.startTime) {
      if (!isRunning) {
        isRunning = true;
        globalCurrentStake = currentSettings.globalStake || 1;
        cumulativeLoss = 0;
        stopScheduledAndWaitingForRecovery = false;
        isTradeActive = false;
        lastLostSymbol = null;
        markets.forEach(m => {
          marketStates[m].streak = 0;
          marketStates[m].evenStreak = 0;
          marketStates[m].oddStreak = 0;
        });
        connectPublicStream();
        connectTradeStream();
        emit({ type: 'SCHEDULE_START' });
        emit({ type: 'STATE_SYNC', isRunning: true, currentStake: globalCurrentStake });
      }
    }

    if (currentSettings.stopTime && current === currentSettings.stopTime) {
      if (isRunning) {
        if (cumulativeLoss > 0) {
          stopScheduledAndWaitingForRecovery = true;
          emit({ type: 'STATE_SYNC', isRunning, isWaitingForRecovery: true, currentStake: globalCurrentStake });
        } else {
          isRunning = false;
          markets.forEach(m => {
            marketStates[m].streak = 0;
            marketStates[m].evenStreak = 0;
            marketStates[m].oddStreak = 0;
          });
          emit({ type: 'SCHEDULE_STOP' });
          emit({ type: 'STATE_SYNC', isRunning: false, currentStake: globalCurrentStake });
        }
      }
    }
  }
}, 1000);

/**
 * 1. Public Market Data WebSocket (No login / No App ID / No Token required)
 */
function getSubscribedMarkets(): string[] {
  if (Array.isArray(currentSettings?.subscribedMarkets)) {
    return currentSettings.subscribedMarkets.filter((s: string) => markets.includes(s));
  }
  return [...markets];
}

function isAutoRotateOver1Enabled(): boolean {
  return (
    (!currentSettings?.strategy || currentSettings.strategy === 'DIGIT_OVER') &&
    Boolean(currentSettings?.autoRotateTop3Over1)
  );
}

function getStreamTargetMarkets(): string[] {
  if (isAutoRotateOver1Enabled()) {
    return [...markets];
  }
  return getSubscribedMarkets();
}

function resetMarketState(symbol: string) {
  const st = marketStates[symbol];
  if (!st) return;
  st.price = 0;
  st.digit = 0;
  st.streak = 0;
  st.evenStreak = 0;
  st.oddStreak = 0;
  st.history.fill(-1);
  st.historyIndex = 0;
  st.ring5kLen = 0;
  st.ring5kWriteIdx = 0;
  st.digitCounts5k.fill(0);
  st.seeded5k = false;
  st.seeding5k = false;
  st.lastSeedEpoch = null;
  delete pendingUpdates[symbol];
}

function pushDigitTo5kWindow(state: MarketState, digit: number) {
  if (digit < 0 || digit > 9) return;
  if (state.ring5kLen < DCIRCLES_WINDOW_SIZE) {
    state.ring5k[state.ring5kLen] = digit;
    state.ring5kLen += 1;
    state.digitCounts5k[digit] += 1;
    if (state.ring5kLen === DCIRCLES_WINDOW_SIZE) {
      state.ring5kWriteIdx = 0;
    }
  } else {
    const evicted = state.ring5k[state.ring5kWriteIdx];
    if (state.digitCounts5k[evicted] > 0) {
      state.digitCounts5k[evicted] -= 1;
    }
    state.ring5k[state.ring5kWriteIdx] = digit;
    state.ring5kWriteIdx = (state.ring5kWriteIdx + 1) % DCIRCLES_WINDOW_SIZE;
    state.digitCounts5k[digit] += 1;
  }
}

function getMarketMeta(symbol: string) {
  const found = SYNTHETIC_MARKET_CATALOG.find((m) => m.symbol === symbol);
  return {
    name: found?.name || symbol,
    shortName: found?.shortName || symbol,
  };
}

function toCompactTopMarkets(ranked: MarketBacktestResult[]) {
  return ranked.slice(0, 5).map((r) => ({
    symbol: r.symbol,
    shortName: r.shortName,
    maxDrawdown: r.maxDrawdown,
    netPnL: r.netPnL,
    riskScore: r.riskScore,
    riskTier: r.riskTier,
    tickCount: r.tickCount,
  }));
}

function applyAutoTop3Selection(top3: string[], topMarkets: any[]) {
  if (!currentSettings || top3.length === 0) return;
  const currentSubscribed = Array.isArray(currentSettings.subscribedMarkets)
    ? currentSettings.subscribedMarkets
    : [...markets];
  const mergedSubscribed = markets.filter(
    (s) => currentSubscribed.includes(s) || top3.includes(s)
  );

  currentSettings = {
    ...currentSettings,
    selectedMarkets: top3,
    subscribedMarkets: mergedSubscribed,
  };
  pendingAutoTop3 = null;

  const seededCount = markets.filter((m) => marketStates[m].seeded5k).length;
  emit({
    type: 'AUTO_MARKETS_UPDATED',
    top3,
    topMarkets,
    seededCount,
    totalCount: markets.length,
    rotatedAt: Date.now(),
  });
}

function evaluateAutoTop3Over1(forceNotify = false) {
  if (!isAutoRotateOver1Enabled()) return;

  const seriesList: MarketTickSeries[] = [];
  let seededCount = 0;

  for (const sym of markets) {
    const st = marketStates[sym];
    if (st.seeded5k) seededCount += 1;
    if (!st.seeded5k || st.ring5kLen < 100) continue;

    const len = st.ring5kLen;
    const digits = new Array<number>(len);
    const start = len === DCIRCLES_WINDOW_SIZE ? st.ring5kWriteIdx : 0;
    for (let i = 0; i < len; i++) {
      digits[i] = st.ring5k[(start + i) % DCIRCLES_WINDOW_SIZE];
    }

    const meta = getMarketMeta(sym);
    seriesList.push({
      symbol: sym,
      name: meta.name,
      shortName: meta.shortName,
      pipSize: st.pipSize,
      prices: [],
      times: [],
      digits,
      fetchedAt: Date.now(),
    });
  }

  if (seriesList.length === 0) {
    if (forceNotify) {
      emit({
        type: 'AUTO_MONITOR_STATUS',
        seededCount,
        totalCount: markets.length,
        top3: [],
        topMarkets: [],
        evaluatedAt: Date.now(),
      });
    }
    return;
  }

  const ranked = runBacktestSuite(seriesList, {
    strategy: 'DIGIT_OVER',
    evenOddMode: 'reversal',
    targetStreak: currentSettings?.targetStreak || 3,
    baseStake: currentSettings?.globalStake || 1,
    useRecovery: true,
    tickCount: DCIRCLES_WINDOW_SIZE,
  });

  const top3 = ranked.slice(0, 3).map((r) => r.symbol);
  const topMarkets = toCompactTopMarkets(ranked);

  const prevSelected = Array.isArray(currentSettings?.selectedMarkets)
    ? currentSettings.selectedMarkets
    : [];
  const prevSet = new Set(prevSelected);
  const hasChanged =
    top3.length > 0 &&
    (top3.length !== prevSet.size || top3.some((sym) => !prevSet.has(sym)));

  if (hasChanged) {
    if (!isTradeActive) {
      applyAutoTop3Selection(top3, topMarkets);
      return;
    } else {
      pendingAutoTop3 = { top3, topMarkets };
    }
  }

  emit({
    type: 'AUTO_MONITOR_STATUS',
    seededCount,
    totalCount: markets.length,
    top3,
    topMarkets,
    evaluatedAt: Date.now(),
  });
}

function syncAutoRotateLoop() {
  if (isAutoRotateOver1Enabled()) {
    if (!autoRotateInterval) {
      autoRotateInterval = setInterval(() => {
        evaluateAutoTop3Over1(false);
      }, 15000);
    }
  } else {
    if (autoRotateInterval) {
      clearInterval(autoRotateInterval);
      autoRotateInterval = null;
    }
    pendingAutoTop3 = null;
    lastSeededReadyEval = false;
  }
}

function seed5kHistoryIfNeeded() {
  if (!publicWs || publicWs.readyState !== WebSocket.OPEN) return;
  const needDCirclesSeed = currentSettings?.strategy === 'DCIRCLES_EVEN_ODD';
  const needAutoOver1Seed = isAutoRotateOver1Enabled();
  if (!needDCirclesSeed && !needAutoOver1Seed) return;

  const targets = needAutoOver1Seed ? [...markets] : getSubscribedMarkets();
  let inflightCount = Object.keys(historyReqIdToSymbol).length;

  for (const symbol of targets) {
    if (inflightCount >= MAX_SEED_CONCURRENCY) break;
    const st = marketStates[symbol];
    if (!st || st.seeded5k || st.seeding5k) continue;
    st.seeding5k = true;
    const reqId = reqIdCounter++;
    historyReqIdToSymbol[reqId] = symbol;
    inflightCount += 1;
    publicWs.send(
      JSON.stringify({
        ticks_history: symbol,
        adjust_start_time: 1,
        count: DCIRCLES_WINDOW_SIZE,
        end: 'latest',
        style: 'ticks',
        req_id: reqId,
      })
    );
  }
}

function subscribeSymbol(symbol: string) {
  if (!publicWs || publicWs.readyState !== WebSocket.OPEN) return;
  if (!activeTickSymbols.has(symbol)) {
    activeTickSymbols.add(symbol);
    publicWs.send(JSON.stringify({ ticks: symbol, subscribe: 1 }));
  }
}

function connectPublicStream() {
  if (publicWs && (publicWs.readyState === WebSocket.OPEN || publicWs.readyState === WebSocket.CONNECTING)) {
    return;
  }

  isSubscribedToMarkets = false;
  activeTickSymbols.clear();
  tickSubIds = {};
  historyReqIdToSymbol = {};
  publicWs = new WebSocket(PUBLIC_WS_URL);

  publicWs.onopen = () => {
    if (publicPingInterval) clearInterval(publicPingInterval);
    publicPingInterval = setInterval(() => {
      if (publicWs && publicWs.readyState === WebSocket.OPEN) {
        publicWs.send('{"ping":1}');
      }
    }, 15000);

    emit({ type: 'STATUS', status: 'connected' });
    subscribeToMarketData();
    seed5kHistoryIfNeeded();
  };

  publicWs.onmessage = (msg) => {
    let data: any;
    try {
      data = JSON.parse(msg.data);
    } catch (e) {
      return;
    }

    if (data.error) {
      const reqId = data?.req_id || data?.echo_req?.req_id;
      if (reqId && historyReqIdToSymbol[reqId]) {
        const failedSym = historyReqIdToSymbol[reqId];
        delete historyReqIdToSymbol[reqId];
        if (marketStates[failedSym]) {
          marketStates[failedSym].seeding5k = false;
        }
        seed5kHistoryIfNeeded();
      }
      emit({ type: 'ERROR', message: data.error.message });
      return;
    }

    if (data.msg_type === 'history' && data.history) {
      const reqId = data?.req_id || data?.echo_req?.req_id;
      const symbol = reqId ? historyReqIdToSymbol[reqId] : undefined;
      if (reqId) delete historyReqIdToSymbol[reqId];
      if (!symbol || !marketStates[symbol]) {
        seed5kHistoryIfNeeded();
        return;
      }

      const state = marketStates[symbol];
      const rawPrices: Array<number | string> = data.history.prices || [];
      const rawTimes: number[] = data.history.times || [];
      const pipSize =
        typeof data.pip_size === 'number' ? Number(data.pip_size) : state.pipSize;

      const startIdx = Math.max(0, rawPrices.length - DCIRCLES_WINDOW_SIZE);
      state.pipSize = pipSize;
      state.ring5kLen = 0;
      state.ring5kWriteIdx = 0;
      state.digitCounts5k.fill(0);

      for (let i = startIdx; i < rawPrices.length; i++) {
        const p = Number(rawPrices[i]);
        if (!Number.isFinite(p)) continue;
        const d = Math.abs(Math.round(p * Math.pow(10, pipSize))) % 10;
        pushDigitTo5kWindow(state, d);
      }

      const lastTime = rawTimes.length > 0 ? rawTimes[rawTimes.length - 1] : null;
      state.lastSeedEpoch = typeof lastTime === 'number' ? lastTime : null;
      state.seeded5k = state.ring5kLen > 0;
      state.seeding5k = false;

      if (getSubscribedMarkets().includes(symbol)) {
        queueUpdate(symbol, state);
      }

      seed5kHistoryIfNeeded();

      if (isAutoRotateOver1Enabled()) {
        const seededCount = markets.filter((m) => marketStates[m].seeded5k).length;
        if (seededCount === markets.length && !lastSeededReadyEval) {
          lastSeededReadyEval = true;
          evaluateAutoTop3Over1(true);
        } else {
          emit({
            type: 'AUTO_MONITOR_STATUS',
            seededCount,
            totalCount: markets.length,
          });
        }
      }
      return;
    }

    if (data.msg_type === 'tick') {
      const sym = data.tick?.symbol;
      if (sym && data.subscription?.id) {
        tickSubIds[sym] = data.subscription.id;
      }
      handleTick(data.tick);
    }
  };

  publicWs.onerror = () => {
    // Handled on close
  };

  publicWs.onclose = () => {
    if (publicPingInterval) clearInterval(publicPingInterval);
    isSubscribedToMarkets = false;
    activeTickSymbols.clear();
    tickSubIds = {};
    historyReqIdToSymbol = {};
    markets.forEach((m) => {
      marketStates[m].seeding5k = false;
    });
    emit({ type: 'STATUS', status: 'disconnected' });
    setTimeout(connectPublicStream, 1500);
  };
}

function subscribeToMarketData() {
  if (!publicWs || publicWs.readyState !== WebSocket.OPEN) return;
  if (isSubscribedToMarkets) return;
  isSubscribedToMarkets = true;

  const targets = getStreamTargetMarkets();
  targets.forEach(symbol => {
    subscribeSymbol(symbol);
  });
}

function syncMarketSubscriptions() {
  if (!publicWs || publicWs.readyState !== WebSocket.OPEN) return;

  const targetList = getStreamTargetMarkets();
  const targetSet = new Set(targetList);

  const toRemove = Array.from(activeTickSymbols).filter(sym => !targetSet.has(sym));
  const toAdd = targetList.filter(sym => !activeTickSymbols.has(sym));

  const missingSubId = toRemove.some(sym => activeTickSymbols.has(sym) && !tickSubIds[sym]);

  if (missingSubId) {
    publicWs.send(JSON.stringify({ forget_all: 'ticks' }));
    activeTickSymbols.clear();
    tickSubIds = {};
    toRemove.forEach(resetMarketState);
    isSubscribedToMarkets = false;
    subscribeToMarketData();
    seed5kHistoryIfNeeded();
    return;
  }

  for (const sym of toRemove) {
    if (tickSubIds[sym]) {
      publicWs.send(JSON.stringify({ forget: tickSubIds[sym] }));
      delete tickSubIds[sym];
    }
    activeTickSymbols.delete(sym);
    resetMarketState(sym);
  }

  for (const sym of toAdd) {
    subscribeSymbol(sym);
  }
  seed5kHistoryIfNeeded();
}

/**
 * 2. Authenticated Trading WebSocket (Supports both Deriv Options OTP WebSocket & Legacy PAT WebSocket)
 */
const OPTIONS_API_BASE = 'https://api.derivws.com/trading/v1/options';

function getTradeWsUrl(): string {
  const appId = fallbackToDefaultAppId ? '1089' : (currentSettings?.appId || '1089');
  return `wss://ws.derivws.com/websockets/v3?app_id=${appId}`;
}

async function fetchOtpWebSocketUrl(accessToken: string, accountId: string): Promise<string> {
  const res = await fetch(`${OPTIONS_API_BASE}/accounts/${encodeURIComponent(accountId)}/otp`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (res.status === 401) {
    emit({ type: 'TOKEN_EXPIRED' });
    throw new Error('OAuth session expired. Refreshing authentication...');
  }

  const payload = await res.json().catch(() => ({}));
  if (!res.ok || !payload?.data?.url) {
    const errMsg =
      payload?.errors?.[0]?.message ||
      payload?.error?.message ||
      payload?.message ||
      `Failed to get WebSocket OTP (${res.status})`;
    throw new Error(errMsg);
  }
  return payload.data.url;
}

async function connectTradeStream() {
  if (!currentSettings?.apiToken) {
    if (tradeWs) {
      try { tradeWs.close(); } catch (e) {}
      tradeWs = null;
    }
    isConnectingTrade = false;
    return;
  }

  if (isConnectingTrade || (tradeWs && (tradeWs.readyState === WebSocket.OPEN || tradeWs.readyState === WebSocket.CONNECTING))) {
    return;
  }

  isConnectingTrade = true;
  const useOtpFlow = currentSettings?.authMethod === 'oauth' && Boolean(currentSettings?.activeAccountId);

  let wsUrl = '';
  if (useOtpFlow) {
    try {
      wsUrl = await fetchOtpWebSocketUrl(currentSettings.apiToken, currentSettings.activeAccountId);
      isOtpSocket = true;
    } catch (err: any) {
      isConnectingTrade = false;
      emit({ type: 'AUTH_ERROR', message: err?.message || 'Failed to authenticate trading WebSocket' });
      return;
    }
  } else {
    isOtpSocket = false;
    wsUrl = getTradeWsUrl();
  }

  try {
    tradeWs = new WebSocket(wsUrl);
  } catch (e) {
    isConnectingTrade = false;
    if (!useOtpFlow) {
      fallbackToDefaultAppId = true;
      tradeWs = new WebSocket('wss://ws.derivws.com/websockets/v3?app_id=1089');
    } else {
      emit({ type: 'AUTH_ERROR', message: 'Failed to open Deriv OTP WebSocket' });
      return;
    }
  }

  tradeWs.onopen = () => {
    isConnectingTrade = false;
    fallbackToDefaultAppId = false;
    if (tradePingInterval) clearInterval(tradePingInterval);
    tradePingInterval = setInterval(() => {
      if (tradeWs && tradeWs.readyState === WebSocket.OPEN) {
        tradeWs.send('{"ping":1}');
      }
    }, 15000);

    if (isOtpSocket) {
      // OTP WebSocket is already authenticated for the selected account
      tradeWs?.send('{"balance":1,"subscribe":1}');
      tradeWs?.send('{"proposal_open_contract":1,"subscribe":1}');
    } else if (currentSettings?.apiToken) {
      tradeWs?.send(JSON.stringify({ authorize: currentSettings.apiToken }));
    }
  };

  tradeWs.onerror = () => {
    isConnectingTrade = false;
    if (!isOtpSocket && currentSettings?.appId && currentSettings.appId !== '1089' && !fallbackToDefaultAppId) {
      fallbackToDefaultAppId = true;
    }
  };

  tradeWs.onmessage = (msg) => {
    let data: any;
    try {
      data = JSON.parse(msg.data);
    } catch (e) {
      return;
    }

    if (data.error) {
      emit({ type: 'ERROR', message: data.error.message });
      if (data.msg_type === 'authorize' || (data.echo_req && data.echo_req.authorize)) {
        emit({ type: 'AUTH_ERROR', message: data.error.message });
      }
      if (data.echo_req && data.echo_req.req_id) {
        const reqId = data.echo_req.req_id;
        if (reqIdToSymbol[reqId]) {
          delete reqIdToSymbol[reqId];
          isTradeActive = false;
          expectedCallbacks = 0;
          if (deadlockTimeoutId) {
            clearTimeout(deadlockTimeoutId);
            deadlockTimeoutId = null;
          }
        }
      }
      return;
    }

    if (data.msg_type === 'authorize') {
      if (data.authorize && data.authorize.balance !== undefined) {
        currentBalance = Number(data.authorize.balance) || 0;
        emit({ type: 'BALANCE', balance: currentBalance });
      }
      emit({
        type: 'AUTH_SUCCESS',
        account: {
          loginid: data.authorize?.loginid,
          currency: data.authorize?.currency,
          fullname: data.authorize?.fullname,
          email: data.authorize?.email,
          is_virtual: data.authorize?.is_virtual,
          balance: data.authorize?.balance,
          account_list: data.authorize?.account_list
        }
      });
      tradeWs?.send('{"balance":1,"subscribe":1}');
      tradeWs?.send('{"proposal_open_contract":1,"subscribe":1}');
    } else if (data.msg_type === 'balance') {
      const balVal = Number(data.balance?.balance ?? data.balance);
      if (!Number.isNaN(balVal)) {
        currentBalance = balVal;
        emit({ type: 'BALANCE', balance: balVal });
      }
    } else if (data.msg_type === 'buy') {
      handleBuy(data.buy, data.echo_req);
    } else if (data.msg_type === 'proposal_open_contract') {
      handleContractUpdate(data.proposal_open_contract);
    } else if (data.msg_type === 'topup_virtual') {
      tradeWs?.send('{"balance":1}');
    }
  };

  tradeWs.onclose = () => {
    isConnectingTrade = false;
    if (tradePingInterval) clearInterval(tradePingInterval);
    tradeWs = null;
    if (currentSettings?.apiToken) {
      setTimeout(connectTradeStream, 2000);
    }
  };
}

function isMarketAllowed(symbol: string): boolean {
  if (!getSubscribedMarkets().includes(symbol)) return false;
  if (!currentSettings) return true;
  if (Array.isArray(currentSettings.selectedMarkets)) {
    return currentSettings.selectedMarkets.includes(symbol);
  }
  return true;
}

function handleTick(tickInfo: any) {
  const symbol = tickInfo.symbol;
  if (!symbol || !getStreamTargetMarkets().includes(symbol)) return;
  const state = marketStates[symbol];
  if (!state) return;

  const price = Number(tickInfo.quote);
  const pipSize = tickInfo.pip_size !== undefined ? Number(tickInfo.pip_size) : state.pipSize;
  const digit = Math.abs(Math.round(price * Math.pow(10, pipSize))) % 10;

  state.price = price;
  state.pipSize = pipSize;
  state.digit = digit;

  const isVisibleMarket = getSubscribedMarkets().includes(symbol);
  if (isVisibleMarket) {
    emit({ type: 'DIGIT_STAT', digit });
  }

  // Evaluate D-Circles signal BEFORE absorbing this tick into the rolling 5K window
  const dCirclesSignalBeforeTick = state.seeded5k
    ? evaluateDCirclesSignal(state.digitCounts5k)
    : null;

  if (state.seeded5k) {
    const epoch = tickInfo.epoch !== undefined ? Number(tickInfo.epoch) : null;
    if (state.lastSeedEpoch !== null && epoch !== null && epoch <= state.lastSeedEpoch) {
      // Skip overlapping seed boundary tick in the 5K ring buffer
    } else {
      state.lastSeedEpoch = null;
      pushDigitTo5kWindow(state, digit);
    }
  }

  // Track Digit Over 1 streak (consecutive 0 or 1 digits)
  if (digit === 0 || digit === 1) {
    state.streak += 1;
  } else {
    state.streak = 0;
  }

  // Track Even / Odd parity streaks
  if (digit % 2 === 0) {
    state.evenStreak += 1;
    state.oddStreak = 0;
  } else {
    state.oddStreak += 1;
    state.evenStreak = 0;
  }

  state.history[state.historyIndex] = digit;
  state.historyIndex = (state.historyIndex + 1) % HISTORY_SIZE;

  if (isVisibleMarket) {
    queueUpdate(symbol, state);
  }

  if (isRunning && currentSettings) {
    const allowed = isMarketAllowed(symbol);
    const now = Date.now();
    const targetStreak = currentSettings.targetStreak || 3;

    if (allowed && !isTradeActive && (now - lastTradeAttemptTime > 1000)) {
      if (currentSettings.strategy === 'DCIRCLES_EVEN_ODD') {
        if (
          state.seeded5k &&
          dCirclesSignalBeforeTick?.contractType &&
          dCirclesSignalBeforeTick.triggerDigits.includes(digit)
        ) {
          isTradeActive = true;
          lastTradeAttemptTime = now;
          executeEvenOdd(symbol, dCirclesSignalBeforeTick.contractType);
        }
      } else if (currentSettings.strategy === 'EVEN_ODD') {
        const mode = currentSettings.evenOddMode || 'reversal';
        if (state.evenStreak >= targetStreak) {
          state.evenStreak = 0;
          isTradeActive = true;
          lastTradeAttemptTime = now;
          executeEvenOdd(symbol, mode === 'follow' ? 'DIGITEVEN' : 'DIGITODD');
        } else if (state.oddStreak >= targetStreak) {
          state.oddStreak = 0;
          isTradeActive = true;
          lastTradeAttemptTime = now;
          executeEvenOdd(symbol, mode === 'follow' ? 'DIGITODD' : 'DIGITEVEN');
        }
      } else if (!currentSettings.strategy || currentSettings.strategy === 'DIGIT_OVER') {
        if (state.streak >= targetStreak) {
          state.streak = 0;
          isTradeActive = true;
          lastTradeAttemptTime = now;
          executeBuy(symbol);
        }
      }
    }
  }
}

function queueUpdate(symbol: string, state: MarketState) {
  const unwrappedHistory = new Array(HISTORY_SIZE);
  for (let i = 0; i < HISTORY_SIZE; i++) {
    unwrappedHistory[i] = state.history[(state.historyIndex + i) % HISTORY_SIZE];
  }

  const dCirclesSignal = state.seeded5k ? evaluateDCirclesSignal(state.digitCounts5k) : null;

  pendingUpdates[symbol] = {
    currentPrice: state.price,
    pipSize: state.pipSize,
    currentDigit: state.digit,
    streak: state.streak,
    evenStreak: state.evenStreak,
    oddStreak: state.oddStreak,
    streakHistory: unwrappedHistory,
    dCirclesTickCount: state.ring5kLen,
    dCirclesMostDigits: dCirclesSignal ? dCirclesSignal.mostDigits : [],
    dCirclesLeastDigits: dCirclesSignal ? dCirclesSignal.leastDigits : [],
  };

  if (!batchTimeout) {
    batchTimeout = setTimeout(() => {
      emit({ type: 'MARKET_UPDATES', updates: pendingUpdates });
      pendingUpdates = {};
      batchTimeout = null;
    }, 250);
  }
}

function executeEvenOdd(symbol: string, contractType: 'DIGITEVEN' | 'DIGITODD') {
  if (!tradeWs || tradeWs.readyState !== WebSocket.OPEN) return;
  if (!currentSettings || !currentSettings.apiToken) return;

  const reqId = reqIdCounter++;
  const stake = globalCurrentStake;

  expectedCallbacks = 1;
  batchPnL = 0;
  batchSymbol = symbol;
  reqIdToSymbol[reqId] = symbol;

  const currency = currentSettings?.accountCurrency || 'USD';
  const buyParameters: Record<string, any> = {
    amount: stake,
    basis: 'stake',
    contract_type: contractType,
    currency,
    duration: 1,
    duration_unit: 't',
  };
  if (isOtpSocket) {
    buyParameters.underlying_symbol = symbol;
  } else {
    buyParameters.symbol = symbol;
  }

  tradeWs.send(JSON.stringify({
    buy: 1,
    price: stake,
    parameters: buyParameters,
    req_id: reqId
  }));

  emit({
    type: 'TRADE_INIT',
    trade: {
      id: reqId.toString(),
      timestamp: Date.now(),
      market: symbol,
      contractId: 0,
      buyPrice: stake,
      result: 'pending',
      pnl: 0,
      contractType
    }
  });

  if (deadlockTimeoutId) {
    clearTimeout(deadlockTimeoutId);
    deadlockTimeoutId = null;
  }

  deadlockTimeoutId = setTimeout(() => {
    if (!isTradeActive) return;

    const customId = reqId.toString();
    const pnl = -stake;

    emit({
      type: 'TRADE_RESULT',
      id: customId,
      market: symbol,
      buyPrice: stake,
      timestamp: Date.now(),
      result: 'lost',
      pnl: pnl,
      entryTick: 'TIMEOUT',
      exitTick: 'TIMEOUT',
      contractType
    });

    cumulativeLoss += Math.abs(pnl);

    const safeYield = 0.95;
    const targetProfit = currentSettings.globalStake * safeYield;
    const preciseRecoveryStake = (cumulativeLoss + targetProfit) / safeYield;
    globalCurrentStake = Math.ceil(preciseRecoveryStake * 100) / 100;

    lastLostSymbol = symbol;
    isTradeActive = false;
    sessionPnL += pnl;

    emit({
      type: 'STATE_SYNC',
      isRunning,
      lastLostSymbol,
      isWaitingForRecovery: stopScheduledAndWaitingForRecovery,
      currentStake: globalCurrentStake
    });

    if (currentSettings && isRunning && sessionPnL <= -currentSettings.stopLoss) {
      isRunning = false;
      emit({ type: 'LIMIT_REACHED', message: 'Stop Loss Hit!' });
      emit({ type: 'STATE_SYNC', isRunning: false, currentStake: globalCurrentStake });
    }
  }, 10000);
}

function executeBuy(symbol: string) {
  if (!tradeWs || tradeWs.readyState !== WebSocket.OPEN) return;
  if (!currentSettings || !currentSettings.apiToken) return;

  const reqId = reqIdCounter++;
  const stake = globalCurrentStake;

  expectedCallbacks = 1;
  batchPnL = 0;
  batchSymbol = symbol;
  reqIdToSymbol[reqId] = symbol;

  const barrier = '1';
  const currency = currentSettings?.accountCurrency || 'USD';
  const buyParameters: Record<string, any> = {
    amount: stake,
    basis: 'stake',
    contract_type: 'DIGITOVER',
    currency,
    duration: 1,
    duration_unit: 't',
    barrier,
  };
  if (isOtpSocket) {
    buyParameters.underlying_symbol = symbol;
  } else {
    buyParameters.symbol = symbol;
  }

  tradeWs.send(JSON.stringify({
    buy: 1,
    price: stake,
    parameters: buyParameters,
    req_id: reqId
  }));

  emit({
    type: 'TRADE_INIT',
    trade: {
      id: reqId.toString(),
      timestamp: Date.now(),
      market: symbol,
      contractId: 0,
      buyPrice: stake,
      result: 'pending',
      pnl: 0
    }
  });

  if (deadlockTimeoutId) {
    clearTimeout(deadlockTimeoutId);
    deadlockTimeoutId = null;
  }

  deadlockTimeoutId = setTimeout(() => {
    if (!isTradeActive) return;

    const customId = reqId.toString();
    const pnl = -stake;

    emit({
      type: 'TRADE_RESULT',
      id: customId,
      market: symbol,
      buyPrice: stake,
      timestamp: Date.now(),
      result: 'lost',
      pnl: pnl,
      entryTick: 'TIMEOUT',
      exitTick: 'TIMEOUT'
    });

    cumulativeLoss += Math.abs(pnl);

    const safeYield = (currentSettings?.strategy === 'EVEN_ODD' || currentSettings?.strategy === 'DCIRCLES_EVEN_ODD') ? 0.95 : 0.21;
    const targetProfit = currentSettings.globalStake * safeYield;
    const preciseRecoveryStake = (cumulativeLoss + targetProfit) / safeYield;
    globalCurrentStake = Math.ceil(preciseRecoveryStake * 100) / 100;

    lastLostSymbol = symbol;
    isTradeActive = false;
    sessionPnL += pnl;

    if (pendingAutoTop3 && isAutoRotateOver1Enabled()) {
      applyAutoTop3Selection(pendingAutoTop3.top3, pendingAutoTop3.topMarkets);
    }

    emit({
      type: 'STATE_SYNC',
      isRunning,
      lastLostSymbol,
      isWaitingForRecovery: stopScheduledAndWaitingForRecovery,
      currentStake: globalCurrentStake
    });

    if (currentSettings && isRunning && sessionPnL <= -currentSettings.stopLoss) {
      isRunning = false;
      emit({ type: 'LIMIT_REACHED', message: 'Stop Loss Hit!' });
      emit({ type: 'STATE_SYNC', isRunning: false, currentStake: globalCurrentStake });
    }
  }, 10000);
}

function handleBuy(buyInfo: any, echo_req: any) {
  const contractId = buyInfo.contract_id;
  const reqId = echo_req?.req_id;
  if (reqId) {
    const symbol = reqIdToSymbol[reqId];
    if (symbol) {
      pendingContracts[contractId] = {
        customId: reqId.toString(),
        symbol,
        stake: Number(buyInfo.buy_price) || globalCurrentStake,
        timestamp: Number(buyInfo.start_time) * 1000 || Date.now()
      };
      delete reqIdToSymbol[reqId];
    }
  }
}

function handleContractUpdate(contract: any) {
  if (!contract.is_expired && !contract.is_sold) {
    return;
  }

  const pending = pendingContracts[contract.contract_id];
  if (!pending) {
    if (!contract.__retries) contract.__retries = 0;
    if (contract.__retries < 5 && (
      contract.contract_type === 'DIGITOVER' ||
      contract.contract_type === 'DIGITDIFF' ||
      contract.contract_type === 'DIGITEVEN' ||
      contract.contract_type === 'DIGITODD'
    )) {
      contract.__retries++;
      setTimeout(() => handleContractUpdate(contract), 250);
    }
    return;
  }

  const { customId, symbol } = pending;
  const pnl = Number(contract.profit) || 0;
  const isWin = pnl > 0;

  const entryTickStr = contract.entry_tick_display_value || String(contract.entry_tick || '');
  const exitTickStr = contract.exit_tick_display_value || String(contract.exit_tick || '');
  const entryDigit = entryTickStr ? parseInt(entryTickStr.slice(-1), 10) : undefined;
  const exitDigit = exitTickStr ? parseInt(exitTickStr.slice(-1), 10) : undefined;

  emit({
    type: 'TRADE_RESULT',
    id: customId,
    market: symbol,
    buyPrice: contract.buy_price || globalCurrentStake,
    timestamp: contract.date_start ? contract.date_start * 1000 : Date.now(),
    result: isWin ? 'won' : 'lost',
    pnl: pnl,
    entryTick: entryTickStr,
    exitTick: exitTickStr,
    entryDigit,
    exitDigit,
    contractType: contract.contract_type
  });

  delete pendingContracts[contract.contract_id];
  sessionPnL += pnl;
  batchPnL += pnl;
  expectedCallbacks -= 1;

  if (expectedCallbacks <= 0) {
    if (deadlockTimeoutId) {
      clearTimeout(deadlockTimeoutId);
      deadlockTimeoutId = null;
    }

    const batchWin = batchPnL > 0;

    if (batchWin) {
      globalCurrentStake = currentSettings.globalStake;
      cumulativeLoss = 0;
      lastLostSymbol = null;

      if (stopScheduledAndWaitingForRecovery) {
        isRunning = false;
        stopScheduledAndWaitingForRecovery = false;
        markets.forEach(m => {
          marketStates[m].streak = 0;
          marketStates[m].evenStreak = 0;
          marketStates[m].oddStreak = 0;
        });
        emit({ type: 'SCHEDULE_STOP' });
      }
    } else {
      cumulativeLoss += Math.abs(batchPnL);
      const safeYield = (currentSettings?.strategy === 'EVEN_ODD' || currentSettings?.strategy === 'DCIRCLES_EVEN_ODD') ? 0.95 : 0.21;
      const targetProfit = currentSettings.globalStake * safeYield;
      const preciseRecoveryStake = (cumulativeLoss + targetProfit) / safeYield;
      globalCurrentStake = Math.ceil(preciseRecoveryStake * 100) / 100;
      lastLostSymbol = symbol;
    }

    isTradeActive = false;
    expectedCallbacks = 0;
    batchPnL = 0;
    batchSymbol = null;

    if (pendingAutoTop3 && isAutoRotateOver1Enabled()) {
      applyAutoTop3Selection(pendingAutoTop3.top3, pendingAutoTop3.topMarkets);
    }

    emit({
      type: 'STATE_SYNC',
      isRunning,
      lastLostSymbol,
      isWaitingForRecovery: stopScheduledAndWaitingForRecovery,
      currentStake: globalCurrentStake
    });

    if (currentSettings && isRunning) {
      if (sessionPnL >= currentSettings.takeProfit) {
        isRunning = false;
        isTradeActive = false;
        emit({ type: 'LIMIT_REACHED', message: 'Take Profit Hit!' });
        emit({ type: 'STATE_SYNC', isRunning: false, currentStake: globalCurrentStake });
        return;
      } else if (sessionPnL <= -currentSettings.stopLoss) {
        isRunning = false;
        isTradeActive = false;
        emit({ type: 'LIMIT_REACHED', message: 'Stop Loss Hit!' });
        emit({ type: 'STATE_SYNC', isRunning: false, currentStake: globalCurrentStake });
        return;
      }
    }
  }
}

// Always connect to the public market stream immediately on worker load (zero login required)
connectPublicStream();

self.onmessage = (e: MessageEvent<WorkerCommand>) => {
  const data = e.data;

  if (data.type === 'INIT') {
    currentSettings = data.settings;
    globalCurrentStake = currentSettings?.globalStake || 1;
    emit({ type: 'STATE_SYNC', isRunning, currentStake: globalCurrentStake });
    syncAutoRotateLoop();
    connectPublicStream();
    if (publicWs && publicWs.readyState === WebSocket.OPEN) {
      syncMarketSubscriptions();
      seed5kHistoryIfNeeded();
      if (isAutoRotateOver1Enabled()) {
        evaluateAutoTop3Over1(true);
      }
    }
    if (currentSettings?.apiToken) {
      connectTradeStream();
    }
  }

  if (data.type === 'UPDATE_SETTINGS') {
    const prevToken = currentSettings?.apiToken;
    const newToken = data.settings?.apiToken;
    const prevAppId = currentSettings?.appId || '1089';
    const newAppId = data.settings?.appId || '1089';
    const prevAccountId = currentSettings?.activeAccountId;
    const newAccountId = data.settings?.activeAccountId;
    const prevAuthMethod = currentSettings?.authMethod;
    const newAuthMethod = data.settings?.authMethod;
    const prevAutoRotate = isAutoRotateOver1Enabled();
    const prevStreak = currentSettings?.targetStreak;
    const prevStake = currentSettings?.globalStake;

    currentSettings = data.settings;
    if (cumulativeLoss === 0 && !isTradeActive) {
      globalCurrentStake = currentSettings?.globalStake || 1;
      emit({ type: 'STATE_SYNC', currentStake: globalCurrentStake });
    }
    syncAutoRotateLoop();
    connectPublicStream();

    if (publicWs && publicWs.readyState === WebSocket.OPEN) {
      syncMarketSubscriptions();
      seed5kHistoryIfNeeded();
      if (
        isAutoRotateOver1Enabled() &&
        (!prevAutoRotate ||
          prevStreak !== currentSettings?.targetStreak ||
          prevStake !== currentSettings?.globalStake)
      ) {
        evaluateAutoTop3Over1(true);
      }
    }

    if (
      newToken !== prevToken ||
      newAppId !== prevAppId ||
      newAccountId !== prevAccountId ||
      newAuthMethod !== prevAuthMethod
    ) {
      if (tradeWs) {
        try { tradeWs.close(); } catch (err) {}
        tradeWs = null;
      }
      if (newToken) {
        connectTradeStream();
      }
    } else if (newToken && (!tradeWs || tradeWs.readyState > 1)) {
      connectTradeStream();
    }
  }

  if (data.type === 'START') {
    currentSettings = data.settings;
    globalCurrentStake = currentSettings?.globalStake || 1;
    cumulativeLoss = 0;
    stopScheduledAndWaitingForRecovery = false;
    isTradeActive = false;
    lastLostSymbol = null;
    sessionPnL = data.sessionPnL || 0;

    markets.forEach(m => {
      marketStates[m].streak = 0;
      marketStates[m].evenStreak = 0;
      marketStates[m].oddStreak = 0;
    });

    isRunning = true;
    emit({ type: 'STATE_SYNC', isRunning: true, currentStake: globalCurrentStake, lastLostSymbol: null, isWaitingForRecovery: false });
    syncAutoRotateLoop();
    connectPublicStream();
    if (publicWs && publicWs.readyState === WebSocket.OPEN) {
      syncMarketSubscriptions();
    }
    seed5kHistoryIfNeeded();
    if (isAutoRotateOver1Enabled()) {
      evaluateAutoTop3Over1(true);
    }
    connectTradeStream();
  }

  if (data.type === 'STOP') {
    isRunning = false;
    isTradeActive = false;
    stopScheduledAndWaitingForRecovery = false;
    globalCurrentStake = currentSettings?.globalStake || 1;
    cumulativeLoss = 0;
    markets.forEach(m => {
      marketStates[m].streak = 0;
      marketStates[m].evenStreak = 0;
      marketStates[m].oddStreak = 0;
    });
    emit({ type: 'STATE_SYNC', isRunning: false, currentStake: globalCurrentStake, isWaitingForRecovery: false });
  }

  if (data.type === 'TOPUP') {
    const useRestReset = isOtpSocket || (currentSettings?.authMethod === 'oauth' && Boolean(currentSettings?.activeAccountId));
    if (useRestReset && currentSettings?.apiToken && currentSettings?.activeAccountId) {
      const accountId = currentSettings.activeAccountId;
      const token = currentSettings.apiToken;
      (async () => {
        try {
          const resetRes = await fetch(
            `${OPTIONS_API_BASE}/accounts/${encodeURIComponent(accountId)}/reset-demo-balance`,
            {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${token}`,
              },
            }
          );

          if (resetRes.status === 401) {
            emit({ type: 'TOKEN_EXPIRED' });
            return;
          }

          const resetPayload = await resetRes.json().catch(() => ({}));
          if (!resetRes.ok) {
            const errMsg =
              resetPayload?.errors?.[0]?.message ||
              resetPayload?.error?.message ||
              resetPayload?.message ||
              `Failed to reset demo balance (${resetRes.status})`;
            emit({ type: 'ERROR', message: errMsg });
            return;
          }

          let updatedBalance: number | null =
            resetPayload?.data?.balance !== undefined ? Number(resetPayload.data.balance) : null;

          if (updatedBalance === null || Number.isNaN(updatedBalance)) {
            const accRes = await fetch(`${OPTIONS_API_BASE}/accounts`, {
              method: 'GET',
              headers: { Authorization: `Bearer ${token}` },
            });
            const accPayload = await accRes.json().catch(() => ({}));
            const list = Array.isArray(accPayload?.data) ? accPayload.data : [];
            const match = list.find((a: any) => a.account_id === accountId);
            if (match?.balance !== undefined) {
              updatedBalance = Number(match.balance);
            }
          }

          if (updatedBalance !== null && !Number.isNaN(updatedBalance)) {
            currentBalance = updatedBalance;
            emit({ type: 'BALANCE', balance: updatedBalance });
            emit({ type: 'TOPUP_SUCCESS', balance: updatedBalance, accountId });
          } else {
            emit({ type: 'TOPUP_SUCCESS', accountId });
          }

          if (tradeWs && tradeWs.readyState === WebSocket.OPEN) {
            tradeWs.send('{"balance":1}');
          }
        } catch (err: any) {
          emit({ type: 'ERROR', message: err?.message || 'Failed to reset demo balance' });
        }
      })();
    } else if (tradeWs && tradeWs.readyState === WebSocket.OPEN) {
      tradeWs.send('{"topup_virtual":1}');
    }
  }
};
