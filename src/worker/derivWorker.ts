export type WorkerCommand = 
  | { type: 'INIT', settings: any }
  | { type: 'START', settings: any, sessionPnL: number }
  | { type: 'STOP' }
  | { type: 'UPDATE_SETTINGS', settings: any }
  | { type: 'TOPUP' };

const PUBLIC_WS_URL = 'wss://api.derivws.com/trading/v1/options/ws/public';
const HISTORY_SIZE = 50;

interface Candle {
  epoch: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

interface MarketState {
  symbol: string;
  price: number;
  pipSize: number;
  digit: number;
  streak: number;
  history: Int8Array;
  historyIndex: number;
  candles: Candle[];
  currentCandle: Candle | null;
  prevCompletedCandle: Candle | null;
  prevTrend: 'bullish' | 'bearish' | 'neutral' | null;
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
    history: new Int8Array(HISTORY_SIZE).fill(-1),
    historyIndex: 0,
    candles: [],
    currentCandle: null,
    prevCompletedCandle: null,
    prevTrend: null
  };
});

// Separate sockets: public market stream (no auth needed) & trading/account socket (when logged in)
let publicWs: WebSocket | null = null;
let publicPingInterval: any = null;
let isSubscribedToMarkets = false;

let tradeWs: WebSocket | null = null;
let tradePingInterval: any = null;
let fallbackToDefaultAppId = false;

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
        markets.forEach(m => { marketStates[m].streak = 0; });
        connectPublicStream();
        connectTradeStream();
        emit({ type: 'SCHEDULE_START' });
      }
    }

    if (currentSettings.stopTime && current === currentSettings.stopTime) {
      if (isRunning) {
        if (cumulativeLoss > 0) {
          stopScheduledAndWaitingForRecovery = true;
        } else {
          isRunning = false;
          markets.forEach(m => { marketStates[m].streak = 0; });
          emit({ type: 'SCHEDULE_STOP' });
        }
      }
    }
  }
}, 1000);

/**
 * 1. Public Market Data WebSocket (No login / No App ID / No Token required)
 */
function connectPublicStream() {
  if (publicWs && (publicWs.readyState === WebSocket.OPEN || publicWs.readyState === WebSocket.CONNECTING)) {
    return;
  }

  isSubscribedToMarkets = false;
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

    if (data.msg_type === 'candles') {
      handleCandles(data);
    } else if (data.msg_type === 'ohlc') {
      handleOhlc(data.ohlc);
    } else if (data.msg_type === 'tick') {
      handleTick(data.tick);
    }
  };

  publicWs.onerror = () => {
    // Handled on close
  };

  publicWs.onclose = () => {
    if (publicPingInterval) clearInterval(publicPingInterval);
    isSubscribedToMarkets = false;
    emit({ type: 'STATUS', status: 'disconnected' });
    setTimeout(connectPublicStream, 1500);
  };
}

function subscribeToMarketData(timeframe?: number) {
  if (!publicWs || publicWs.readyState !== WebSocket.OPEN) return;
  if (isSubscribedToMarkets && !timeframe) return;
  isSubscribedToMarkets = true;

  markets.forEach(symbol => {
    publicWs?.send(JSON.stringify({ ticks: symbol, subscribe: 1 }));
  });

  const tf = timeframe || currentSettings?.timeframe || 60;
  markets.forEach(symbol => {
    publicWs?.send(JSON.stringify({
      ticks_history: symbol,
      style: 'candles',
      end: 'latest',
      count: 10,
      granularity: tf,
      subscribe: 1
    }));
  });
}

/**
 * 2. Authenticated Trading WebSocket (Only connects when an API token is configured)
 */
function getTradeWsUrl(): string {
  const appId = fallbackToDefaultAppId ? '1089' : (currentSettings?.appId || '1089');
  return `wss://ws.derivws.com/websockets/v3?app_id=${appId}`;
}

function connectTradeStream() {
  if (!currentSettings?.apiToken) {
    if (tradeWs) {
      try { tradeWs.close(); } catch (e) {}
      tradeWs = null;
    }
    return;
  }

  if (tradeWs && (tradeWs.readyState === WebSocket.OPEN || tradeWs.readyState === WebSocket.CONNECTING)) {
    return;
  }

  try {
    tradeWs = new WebSocket(getTradeWsUrl());
  } catch (e) {
    fallbackToDefaultAppId = true;
    tradeWs = new WebSocket('wss://ws.derivws.com/websockets/v3?app_id=1089');
  }

  tradeWs.onopen = () => {
    fallbackToDefaultAppId = false;
    if (tradePingInterval) clearInterval(tradePingInterval);
    tradePingInterval = setInterval(() => {
      if (tradeWs && tradeWs.readyState === WebSocket.OPEN) {
        tradeWs.send('{"ping":1}');
      }
    }, 15000);

    if (currentSettings?.apiToken) {
      tradeWs?.send(JSON.stringify({ authorize: currentSettings.apiToken }));
    }
  };

  tradeWs.onerror = () => {
    if (currentSettings?.appId && currentSettings.appId !== '1089' && !fallbackToDefaultAppId) {
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
        currentBalance = data.authorize.balance;
        emit({ type: 'BALANCE', balance: data.authorize.balance });
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
      currentBalance = data.balance.balance;
      emit({ type: 'BALANCE', balance: data.balance.balance });
    } else if (data.msg_type === 'buy') {
      handleBuy(data.buy, data.echo_req);
    } else if (data.msg_type === 'proposal_open_contract') {
      handleContractUpdate(data.proposal_open_contract);
    } else if (data.msg_type === 'topup_virtual') {
      tradeWs?.send('{"balance":1}');
    }
  };

  tradeWs.onclose = () => {
    if (tradePingInterval) clearInterval(tradePingInterval);
    tradeWs = null;
    if (currentSettings?.apiToken) {
      setTimeout(connectTradeStream, 2000);
    }
  };
}

function handleCandles(data: any) {
  const symbol = data.echo_req?.ticks_history;
  if (!symbol) return;
  const state = marketStates[symbol];
  if (!state || !Array.isArray(data.candles)) return;

  if (data.pip_size !== undefined) {
    state.pipSize = Number(data.pip_size);
  }

  state.candles = data.candles.map((c: any) => ({
    epoch: Number(c.epoch),
    open: Number(c.open),
    high: Number(c.high),
    low: Number(c.low),
    close: Number(c.close)
  }));

  if (state.candles.length >= 2) {
    state.prevCompletedCandle = { ...state.candles[state.candles.length - 2] };
    state.currentCandle = { ...state.candles[state.candles.length - 1] };
    const pOpen = state.prevCompletedCandle.open;
    const pClose = state.prevCompletedCandle.close;
    state.prevTrend = pClose > pOpen ? 'bullish' : pClose < pOpen ? 'bearish' : 'neutral';
  } else if (state.candles.length === 1) {
    state.currentCandle = { ...state.candles[0] };
  }

  queueUpdate(symbol, state);
}

function isMarketAllowed(symbol: string): boolean {
  if (!currentSettings) return true;
  if (Array.isArray(currentSettings.selectedMarkets)) {
    return currentSettings.selectedMarkets.includes(symbol);
  }
  if (currentSettings.selectedMarket && currentSettings.selectedMarket !== 'ALL') {
    return currentSettings.selectedMarket === symbol;
  }
  return true;
}

function handleOhlc(ohlc: any) {
  const symbol = ohlc.symbol;
  const state = marketStates[symbol];
  if (!state) return;

  if (ohlc.pip_size !== undefined) {
    state.pipSize = Number(ohlc.pip_size);
  }

  const candleEpoch = Number(ohlc.open_time || ohlc.epoch);
  const open = Number(ohlc.open);
  const high = Number(ohlc.high);
  const low = Number(ohlc.low);
  const close = Number(ohlc.close);

  state.price = close;

  if (state.currentCandle && candleEpoch > state.currentCandle.epoch) {
    state.prevCompletedCandle = { ...state.currentCandle };
    const prevOpen = state.prevCompletedCandle.open;
    const prevClose = state.prevCompletedCandle.close;
    const trend: 'bullish' | 'bearish' | 'neutral' =
      prevClose > prevOpen ? 'bullish' : prevClose < prevOpen ? 'bearish' : 'neutral';
    state.prevTrend = trend;

    state.candles.push({ ...state.prevCompletedCandle });
    if (state.candles.length > 15) {
      state.candles.shift();
    }

    state.currentCandle = { epoch: candleEpoch, open, high, low, close };

    if (isRunning && currentSettings && currentSettings.strategy === 'RISE_FALL') {
      const allowed = isMarketAllowed(symbol);

      if (allowed && !isTradeActive) {
        const now = Date.now();
        if (now - lastTradeAttemptTime > 1000) {
          if (trend === 'bullish') {
            isTradeActive = true;
            lastTradeAttemptTime = now;
            executeRiseFall(symbol, 'CALL');
          } else if (trend === 'bearish') {
            isTradeActive = true;
            lastTradeAttemptTime = now;
            executeRiseFall(symbol, 'PUT');
          }
        }
      }
    }
  } else {
    if (!state.currentCandle) {
      state.currentCandle = { epoch: candleEpoch, open, high, low, close };
    } else {
      state.currentCandle.high = Math.max(state.currentCandle.high, high);
      state.currentCandle.low = Math.min(state.currentCandle.low, low);
      state.currentCandle.close = close;
    }
  }

  queueUpdate(symbol, state);
}

function handleTick(tickInfo: any) {
  const symbol = tickInfo.symbol;
  const state = marketStates[symbol];
  if (!state) return;

  const price = Number(tickInfo.quote);
  const pipSize = tickInfo.pip_size !== undefined ? Number(tickInfo.pip_size) : state.pipSize;
  const digit = Math.round(price * Math.pow(10, pipSize)) % 10;

  state.price = price;
  state.pipSize = pipSize;
  state.digit = digit;

  emit({ type: 'DIGIT_STAT', digit });

  if (digit === 0 || digit === 1) {
    state.streak += 1;
  } else {
    state.streak = 0;
  }

  state.history[state.historyIndex] = digit;
  state.historyIndex = (state.historyIndex + 1) % HISTORY_SIZE;

  queueUpdate(symbol, state);

  if (isRunning && currentSettings && (!currentSettings.strategy || currentSettings.strategy === 'DIGIT_OVER')) {
    const allowed = isMarketAllowed(symbol);
    const now = Date.now();
    if (allowed && !isTradeActive && (now - lastTradeAttemptTime > 1000)) {
      if (state.streak >= (currentSettings.targetStreak || 3)) {
        state.streak = 0;
        isTradeActive = true;
        lastTradeAttemptTime = now;
        executeBuy(symbol);
      }
    }
  }
}

function queueUpdate(symbol: string, state: MarketState) {
  const unwrappedHistory = new Array(HISTORY_SIZE);
  for (let i = 0; i < HISTORY_SIZE; i++) {
    unwrappedHistory[i] = state.history[(state.historyIndex + i) % HISTORY_SIZE];
  }

  const tf = currentSettings?.timeframe || 60;
  const nowSec = Math.floor(Date.now() / 1000);
  const currentEpoch = state.currentCandle?.epoch || (Math.floor(nowSec / tf) * tf);
  const elapsed = Math.max(0, nowSec - currentEpoch);
  const timeRemaining = Math.max(0, tf - elapsed);

  pendingUpdates[symbol] = {
    currentPrice: state.price,
    pipSize: state.pipSize,
    currentDigit: state.digit,
    streak: state.streak,
    streakHistory: unwrappedHistory,
    candleOpen: state.currentCandle?.open,
    candleHigh: state.currentCandle?.high,
    candleLow: state.currentCandle?.low,
    candleClose: state.currentCandle?.close,
    prevCandleOpen: state.prevCompletedCandle?.open,
    prevCandleClose: state.prevCompletedCandle?.close,
    prevCandleTrend: state.prevTrend,
    candleTimeRemaining: timeRemaining,
    candleHistory: state.candles.map(c => ({
      epoch: c.epoch,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      trend: c.close > c.open ? 'bullish' : c.close < c.open ? 'bearish' : 'neutral'
    }))
  };

  if (!batchTimeout) {
    batchTimeout = setTimeout(() => {
      emit({ type: 'MARKET_UPDATES', updates: pendingUpdates });
      pendingUpdates = {};
      batchTimeout = null;
    }, 250);
  }
}

function executeRiseFall(symbol: string, direction: 'CALL' | 'PUT') {
  if (!tradeWs || tradeWs.readyState !== WebSocket.OPEN) return;
  if (!currentSettings || !currentSettings.apiToken) return;

  const reqId = reqIdCounter++;
  const stake = globalCurrentStake;

  expectedCallbacks = 1;
  batchPnL = 0;
  batchSymbol = symbol;
  reqIdToSymbol[reqId] = symbol;

  const duration = Number(currentSettings.tradeDuration) || 1;
  const durationUnit = currentSettings.tradeDurationUnit || 'm';

  tradeWs.send(JSON.stringify({
    buy: 1,
    price: stake,
    parameters: {
      amount: stake,
      basis: 'stake',
      contract_type: direction,
      currency: 'USD',
      duration: duration,
      duration_unit: durationUnit,
      symbol: symbol
    },
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
      contractType: direction
    }
  });

  if (deadlockTimeoutId) {
    clearTimeout(deadlockTimeoutId);
    deadlockTimeoutId = null;
  }

  let timeoutMs = 25000;
  if (durationUnit === 'm') {
    timeoutMs = (duration * 60 + 25) * 1000;
  } else if (durationUnit === 's') {
    timeoutMs = (duration + 25) * 1000;
  } else if (durationUnit === 't') {
    timeoutMs = (duration * 3 + 20) * 1000;
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
      contractType: direction
    });

    cumulativeLoss += Math.abs(pnl);

    const safeYield = (currentSettings?.strategy === 'RISE_FALL') ? 0.92 : 0.21;
    const targetProfit = currentSettings.globalStake * safeYield;
    const preciseRecoveryStake = (cumulativeLoss + targetProfit) / safeYield;
    globalCurrentStake = Math.ceil(preciseRecoveryStake * 100) / 100;

    lastLostSymbol = symbol;
    isTradeActive = false;
    sessionPnL += pnl;

    if (currentSettings && isRunning && sessionPnL <= -currentSettings.stopLoss) {
      isRunning = false;
      emit({ type: 'LIMIT_REACHED', message: 'Stop Loss Hit!' });
    }
  }, timeoutMs);
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
  const rawPayloadString = `{"buy":1,"price":${stake},"parameters":{"amount":${stake},"basis":"stake","contract_type":"DIGITOVER","currency":"USD","duration":1,"duration_unit":"t","symbol":"${symbol}","barrier":"${barrier}"},"req_id":${reqId}}`;

  tradeWs.send(rawPayloadString);

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

    const safeYield = (currentSettings?.strategy === 'RISE_FALL') ? 0.92 : 0.21;
    const targetProfit = currentSettings.globalStake * safeYield;
    const preciseRecoveryStake = (cumulativeLoss + targetProfit) / safeYield;
    globalCurrentStake = Math.ceil(preciseRecoveryStake * 100) / 100;

    lastLostSymbol = symbol;
    isTradeActive = false;
    sessionPnL += pnl;

    if (currentSettings && isRunning && sessionPnL <= -currentSettings.stopLoss) {
      isRunning = false;
      emit({ type: 'LIMIT_REACHED', message: 'Stop Loss Hit!' });
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
      contract.contract_type === 'CALL' ||
      contract.contract_type === 'PUT'
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
        markets.forEach(m => { marketStates[m].streak = 0; });
        emit({ type: 'SCHEDULE_STOP' });
      }
    } else {
      cumulativeLoss += Math.abs(batchPnL);
      const safeYield = (currentSettings?.strategy === 'RISE_FALL') ? 0.92 : 0.21;
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
      isWaitingForRecovery: stopScheduledAndWaitingForRecovery
    });

    if (currentSettings && isRunning) {
      if (sessionPnL >= currentSettings.takeProfit) {
        isRunning = false;
        isTradeActive = false;
        emit({ type: 'LIMIT_REACHED', message: 'Take Profit Hit!' });
        return;
      } else if (sessionPnL <= -currentSettings.stopLoss) {
        isRunning = false;
        isTradeActive = false;
        emit({ type: 'LIMIT_REACHED', message: 'Stop Loss Hit!' });
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
    connectPublicStream();
    if (currentSettings?.apiToken) {
      connectTradeStream();
    }
  }

  if (data.type === 'UPDATE_SETTINGS') {
    const prevTf = currentSettings?.timeframe || 60;
    const newTf = data.settings?.timeframe || 60;
    const prevToken = currentSettings?.apiToken;
    const newToken = data.settings?.apiToken;
    const prevAppId = currentSettings?.appId || '1089';
    const newAppId = data.settings?.appId || '1089';

    currentSettings = data.settings;
    connectPublicStream();

    if (publicWs && publicWs.readyState === WebSocket.OPEN && newTf !== prevTf) {
      publicWs.send(JSON.stringify({ forget_all: 'candles' }));
      isSubscribedToMarkets = false;
      subscribeToMarketData(newTf);
    }

    if (newToken !== prevToken || newAppId !== prevAppId) {
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
    });

    isRunning = true;
    emit({ type: 'STATE_SYNC', isRunning: true });
    connectPublicStream();
    connectTradeStream();
  }

  if (data.type === 'STOP') {
    isRunning = false;
    isTradeActive = false;
    stopScheduledAndWaitingForRecovery = false;
    markets.forEach(m => {
      marketStates[m].streak = 0;
    });
    emit({ type: 'STATE_SYNC', isRunning: false });
  }

  if (data.type === 'TOPUP') {
    if (tradeWs && tradeWs.readyState === WebSocket.OPEN) {
      tradeWs.send('{"topup_virtual":1}');
    }
  }
};
