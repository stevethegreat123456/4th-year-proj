export type WorkerCommand = 
  | { type: 'INIT', settings: any }
  | { type: 'START', settings: any, sessionPnL: number }
  | { type: 'STOP' }
  | { type: 'UPDATE_SETTINGS', settings: any }
  | { type: 'TOPUP' };

const PUBLIC_WS_URL = 'wss://api.derivws.com/trading/v1/options/ws/public';
const HISTORY_SIZE = 20;

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
    historyIndex: 0
  };
});

// Separate sockets: public market stream (no auth needed) & trading/account socket (when logged in)
let publicWs: WebSocket | null = null;
let publicPingInterval: any = null;
let isSubscribedToMarkets = false;
const activeTickSymbols = new Set<string>();
let tickSubIds: Record<string, string> = {};

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
  delete pendingUpdates[symbol];
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
  };

  publicWs.onmessage = (msg) => {
    let data: any;
    try {
      data = JSON.parse(msg.data);
    } catch (e) {
      return;
    }

    if (data.error) {
      emit({ type: 'ERROR', message: data.error.message });
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
    emit({ type: 'STATUS', status: 'disconnected' });
    setTimeout(connectPublicStream, 1500);
  };
}

function subscribeToMarketData() {
  if (!publicWs || publicWs.readyState !== WebSocket.OPEN) return;
  if (isSubscribedToMarkets) return;
  isSubscribedToMarkets = true;

  const targets = getSubscribedMarkets();
  targets.forEach(symbol => {
    subscribeSymbol(symbol);
  });
}

function syncMarketSubscriptions() {
  if (!publicWs || publicWs.readyState !== WebSocket.OPEN) return;

  const targetList = getSubscribedMarkets();
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
  if (!symbol || !getSubscribedMarkets().includes(symbol)) return;
  const state = marketStates[symbol];
  if (!state) return;

  const price = Number(tickInfo.quote);
  const pipSize = tickInfo.pip_size !== undefined ? Number(tickInfo.pip_size) : state.pipSize;
  const digit = Math.round(price * Math.pow(10, pipSize)) % 10;

  state.price = price;
  state.pipSize = pipSize;
  state.digit = digit;

  emit({ type: 'DIGIT_STAT', digit });

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

  queueUpdate(symbol, state);

  if (isRunning && currentSettings) {
    const allowed = isMarketAllowed(symbol);
    const now = Date.now();
    const targetStreak = currentSettings.targetStreak || 3;

    if (allowed && !isTradeActive && (now - lastTradeAttemptTime > 1000)) {
      if (currentSettings.strategy === 'EVEN_ODD') {
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

  pendingUpdates[symbol] = {
    currentPrice: state.price,
    pipSize: state.pipSize,
    currentDigit: state.digit,
    streak: state.streak,
    evenStreak: state.evenStreak,
    oddStreak: state.oddStreak,
    streakHistory: unwrappedHistory
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

    const safeYield = (currentSettings?.strategy === 'EVEN_ODD') ? 0.95 : 0.21;
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
      const safeYield = (currentSettings?.strategy === 'EVEN_ODD') ? 0.95 : 0.21;
      const targetProfit = currentSettings.globalStake * safeYield;
      const preciseRecoveryStake = (cumulativeLoss + targetProfit) / safeYield;
      globalCurrentStake = Math.ceil(preciseRecoveryStake * 100) / 100;
      lastLostSymbol = symbol;
    }

    isTradeActive = false;
    expectedCallbacks = 0;
    batchPnL = 0;
    batchSymbol = null;

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
    connectPublicStream();
    if (publicWs && publicWs.readyState === WebSocket.OPEN) {
      syncMarketSubscriptions();
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

    currentSettings = data.settings;
    if (cumulativeLoss === 0 && !isTradeActive) {
      globalCurrentStake = currentSettings?.globalStake || 1;
      emit({ type: 'STATE_SYNC', currentStake: globalCurrentStake });
    }
    connectPublicStream();

    if (publicWs && publicWs.readyState === WebSocket.OPEN) {
      syncMarketSubscriptions();
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
    connectPublicStream();
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
    if (tradeWs && tradeWs.readyState === WebSocket.OPEN) {
      tradeWs.send('{"topup_virtual":1}');
    }
  }
};
