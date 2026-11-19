import {
  ALL_MARKET_SYMBOLS,
  EvenOddMode,
  SYNTHETIC_MARKET_CATALOG,
  StrategyType,
} from '../store/useStore';

const PUBLIC_WS_URL = 'wss://api.derivws.com/trading/v1/options/ws/public';

const DEFAULT_PIP_SIZES: Record<string, number> = {
  R_10: 3,
  R_25: 3,
  R_50: 4,
  R_75: 4,
  R_100: 2,
  '1HZ10V': 2,
  '1HZ25V': 2,
  '1HZ50V': 2,
  '1HZ75V': 2,
  '1HZ100V': 2,
  JD10: 2,
  JD25: 2,
  JD50: 2,
  JD75: 2,
  JD100: 2,
  RDBEAR: 4,
  RDBULL: 4,
};

export interface MarketTickSeries {
  symbol: string;
  name: string;
  shortName: string;
  pipSize: number;
  prices: number[];
  times: number[];
  digits: number[];
  fetchedAt: number;
}

export interface BacktestConfig {
  strategy: StrategyType;
  evenOddMode: EvenOddMode;
  targetStreak: number;
  baseStake: number;
  useRecovery: boolean;
  tickCount: number;
}

export interface SimulatedTrade {
  index: number;
  tickIndex: number;
  timestamp: number;
  contractType: 'DIGITEVEN' | 'DIGITODD' | 'DIGITOVER';
  triggerDigits: number[];
  exitDigit: number;
  stake: number;
  won: boolean;
  pnl: number;
  equityAfter: number;
  drawdownAfter: number;
}

export interface EquityPoint {
  tradeIndex: number;
  tickIndex: number;
  equity: number;
  drawdown: number;
}

export interface MarketBacktestResult {
  symbol: string;
  name: string;
  shortName: string;
  tickCount: number;
  timespanMinutes: number;
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  netPnL: number;
  grossProfit: number;
  grossLoss: number;
  profitFactor: number;
  maxDrawdown: number;
  maxDrawdownPct: number;
  recoveryFactor: number;
  maxConsecutiveLosses: number;
  maxStakeUsed: number;
  longestTriggerStreak: number;
  digitCounts: number[];
  evenPct: number;
  oddPct: number;
  lowDigitPct: number;
  riskScore: number;
  riskTier: 'LOW' | 'MODERATE' | 'ELEVATED' | 'HIGH';
  equityCurve: EquityPoint[];
  recentTrades: SimulatedTrade[];
}

export interface FetchProgress {
  completed: number;
  total: number;
  currentSymbol: string;
}

function getMarketMeta(symbol: string) {
  const found = SYNTHETIC_MARKET_CATALOG.find((m) => m.symbol === symbol);
  return {
    name: found?.name || symbol,
    shortName: found?.shortName || symbol,
  };
}

function extractLastDigit(rawPrice: string | number, pipSize: number): number {
  const num = typeof rawPrice === 'number' ? rawPrice : Number(rawPrice);
  if (!Number.isFinite(num)) return 0;
  return Math.abs(Math.round(num * Math.pow(10, pipSize))) % 10;
}

/**
 * Fetches historical ticks (default 5,000) for all requested Deriv synthetic indices
 * via Deriv's unauthenticated public WebSocket endpoint.
 */
export async function fetchMarketsTickHistory(
  symbols: string[] = [...ALL_MARKET_SYMBOLS],
  count: number = 5000,
  onProgress?: (progress: FetchProgress) => void
): Promise<{ series: MarketTickSeries[]; errors: Record<string, string> }> {
  const uniqueSymbols = symbols.filter((s) => ALL_MARKET_SYMBOLS.includes(s as any));
  if (uniqueSymbols.length === 0) {
    return { series: [], errors: {} };
  }

  return new Promise((resolve, reject) => {
    let ws: WebSocket;
    try {
      ws = new WebSocket(PUBLIC_WS_URL);
    } catch (err: any) {
      reject(new Error(err?.message || 'Failed to open Deriv public WebSocket'));
      return;
    }

    const resultsMap: Record<string, MarketTickSeries> = {};
    const errors: Record<string, string> = {};
    const queue = [...uniqueSymbols];
    const inflight = new Map<
      number,
      { symbol: string; timeoutId: ReturnType<typeof setTimeout>; attempts: number }
    >();

    let reqCounter = 1000;
    let completed = 0;
    let finished = false;
    const CONCURRENCY = 4;

    const cleanup = () => {
      for (const entry of inflight.values()) {
        clearTimeout(entry.timeoutId);
      }
      inflight.clear();
      try {
        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
          ws.close();
        }
      } catch {
        // ignore close errors
      }
    };

    const finish = () => {
      if (finished) return;
      finished = true;
      cleanup();
      const orderedSeries = uniqueSymbols
        .map((sym) => resultsMap[sym])
        .filter((item): item is MarketTickSeries => Boolean(item));
      resolve({ series: orderedSeries, errors });
    };

    const markDone = (symbol: string) => {
      completed += 1;
      onProgress?.({
        completed,
        total: uniqueSymbols.length,
        currentSymbol: symbol,
      });
      if (completed >= uniqueSymbols.length) {
        finish();
      } else {
        pumpQueue();
      }
    };

    const sendSymbolRequest = (symbol: string, attempts = 1) => {
      if (finished || ws.readyState !== WebSocket.OPEN) return;
      const reqId = reqCounter++;

      const timeoutId = setTimeout(() => {
        const current = inflight.get(reqId);
        if (!current) return;
        inflight.delete(reqId);
        if (current.attempts < 2 && ws.readyState === WebSocket.OPEN) {
          sendSymbolRequest(symbol, current.attempts + 1);
        } else {
          errors[symbol] = 'Timed out fetching tick history';
          markDone(symbol);
        }
      }, 15000);

      inflight.set(reqId, { symbol, timeoutId, attempts });

      ws.send(
        JSON.stringify({
          ticks_history: symbol,
          adjust_start_time: 1,
          count: Math.min(Math.max(count, 100), 5000),
          end: 'latest',
          style: 'ticks',
          req_id: reqId,
        })
      );
    };

    const pumpQueue = () => {
      while (!finished && ws.readyState === WebSocket.OPEN && inflight.size < CONCURRENCY && queue.length > 0) {
        const nextSymbol = queue.shift();
        if (nextSymbol) {
          sendSymbolRequest(nextSymbol, 1);
        }
      }
    };

    const globalTimeout = setTimeout(() => {
      if (!finished) {
        for (const sym of uniqueSymbols) {
          if (!resultsMap[sym] && !errors[sym]) {
            errors[sym] = 'Connection timeout';
          }
        }
        finish();
      }
    }, 60000);

    ws.onopen = () => {
      onProgress?.({
        completed: 0,
        total: uniqueSymbols.length,
        currentSymbol: uniqueSymbols[0],
      });
      pumpQueue();
    };

    ws.onmessage = (event) => {
      if (finished) return;
      let data: any;
      try {
        data = JSON.parse(event.data);
      } catch {
        return;
      }

      const reqId = data?.req_id || data?.echo_req?.req_id;
      if (!reqId || !inflight.has(reqId)) return;

      const entry = inflight.get(reqId)!;
      clearTimeout(entry.timeoutId);
      inflight.delete(reqId);

      if (data.error) {
        errors[entry.symbol] = data.error.message || 'Deriv API error';
        markDone(entry.symbol);
        return;
      }

      const rawPrices: Array<number | string> = data.history?.prices || [];
      const rawTimes: number[] = data.history?.times || [];
      const pipSize =
        typeof data.pip_size === 'number'
          ? data.pip_size
          : DEFAULT_PIP_SIZES[entry.symbol] ?? 2;

      const prices = rawPrices.map((p) => Number(p));
      const digits = rawPrices.map((p) => extractLastDigit(p, pipSize));
      const meta = getMarketMeta(entry.symbol);

      resultsMap[entry.symbol] = {
        symbol: entry.symbol,
        name: meta.name,
        shortName: meta.shortName,
        pipSize,
        prices,
        times: rawTimes,
        digits,
        fetchedAt: Date.now(),
      };

      markDone(entry.symbol);
    };

    ws.onerror = () => {
      if (!finished && completed === 0) {
        clearTimeout(globalTimeout);
        cleanup();
        reject(new Error('Failed to connect to Deriv public tick history stream.'));
      }
    };

    ws.onclose = () => {
      clearTimeout(globalTimeout);
      if (!finished) {
        for (const sym of uniqueSymbols) {
          if (!resultsMap[sym] && !errors[sym]) {
            errors[sym] = 'WebSocket closed before completing';
          }
        }
        finish();
      }
    };
  });
}

function downsampleCurve(points: EquityPoint[], maxPoints = 90): EquityPoint[] {
  if (points.length <= maxPoints) return points;
  const step = (points.length - 1) / (maxPoints - 1);
  const sampled: EquityPoint[] = [];
  for (let i = 0; i < maxPoints; i++) {
    const idx = Math.min(points.length - 1, Math.round(i * step));
    sampled.push(points[idx]);
  }
  return sampled;
}

/**
 * Runs an exact tick-by-tick simulation of the bot's DIGIT_OVER or EVEN_ODD logic
 * over a historical tick series (up to 5,000 ticks) and calculates drawdown-focused metrics.
 */
export function simulateMarketBacktest(
  series: MarketTickSeries,
  config: BacktestConfig
): MarketBacktestResult {
  const digits = series.digits.slice(-Math.max(100, config.tickCount));
  const times = series.times.slice(-digits.length);

  const digitCounts = Array(10).fill(0);
  let evenCount = 0;
  let oddCount = 0;
  let lowDigitCount = 0;

  for (const d of digits) {
    if (d >= 0 && d <= 9) {
      digitCounts[d] += 1;
      if (d % 2 === 0) evenCount += 1;
      else oddCount += 1;
      if (d === 0 || d === 1) lowDigitCount += 1;
    }
  }

  const n = digits.length || 1;
  const timespanMinutes =
    times.length >= 2 ? Math.max(1, (times[times.length - 1] - times[0]) / 60) : 0;

  const targetStreak = Math.max(1, Math.min(10, Math.round(config.targetStreak || 3)));
  const baseStake = Math.max(0.35, Number(config.baseStake) || 1);
  const safeYield = config.strategy === 'EVEN_ODD' ? 0.95 : 0.21;

  let over1Streak = 0;
  let evenStreak = 0;
  let oddStreak = 0;
  let longestTriggerStreak = 0;

  // Also track unconstrained streak lengths across all ticks for tail-risk visibility
  let rawOver1 = 0;
  let rawEven = 0;
  let rawOdd = 0;
  for (const d of digits) {
    if (d === 0 || d === 1) {
      rawOver1 += 1;
      if (config.strategy === 'DIGIT_OVER' && rawOver1 > longestTriggerStreak) {
        longestTriggerStreak = rawOver1;
      }
    } else {
      rawOver1 = 0;
    }

    if (d % 2 === 0) {
      rawEven += 1;
      rawOdd = 0;
      if (config.strategy === 'EVEN_ODD' && rawEven > longestTriggerStreak) {
        longestTriggerStreak = rawEven;
      }
    } else {
      rawOdd += 1;
      rawEven = 0;
      if (config.strategy === 'EVEN_ODD' && rawOdd > longestTriggerStreak) {
        longestTriggerStreak = rawOdd;
      }
    }
  }

  let currentStake = baseStake;
  let cumulativeLoss = 0;
  let equity = 0;
  let peakEquity = 0;
  let maxDrawdown = 0;
  let consecutiveLosses = 0;
  let maxConsecutiveLosses = 0;
  let maxStakeUsed = baseStake;
  let wins = 0;
  let losses = 0;
  let grossProfit = 0;
  let grossLoss = 0;

  const fullCurve: EquityPoint[] = [{ tradeIndex: 0, tickIndex: 0, equity: 0, drawdown: 0 }];
  const allTrades: SimulatedTrade[] = [];

  for (let i = 0; i < digits.length - 1; i++) {
    const d = digits[i];

    if (d === 0 || d === 1) {
      over1Streak += 1;
    } else {
      over1Streak = 0;
    }

    if (d % 2 === 0) {
      evenStreak += 1;
      oddStreak = 0;
    } else {
      oddStreak += 1;
      evenStreak = 0;
    }

    let contractType: 'DIGITEVEN' | 'DIGITODD' | 'DIGITOVER' | null = null;
    if (config.strategy === 'EVEN_ODD') {
      if (evenStreak >= targetStreak) {
        contractType = config.evenOddMode === 'follow' ? 'DIGITEVEN' : 'DIGITODD';
        evenStreak = 0;
        oddStreak = 0;
      } else if (oddStreak >= targetStreak) {
        contractType = config.evenOddMode === 'follow' ? 'DIGITODD' : 'DIGITEVEN';
        evenStreak = 0;
        oddStreak = 0;
      }
    } else {
      if (over1Streak >= targetStreak) {
        contractType = 'DIGITOVER';
        over1Streak = 0;
      }
    }

    if (contractType) {
      // Settle on next tick (1-tick contract), mirroring live single-active-trade gate
      const exitIdx = i + 1;
      const exitDigit = digits[exitIdx];
      const won =
        contractType === 'DIGITOVER'
          ? exitDigit > 1
          : contractType === 'DIGITEVEN'
            ? exitDigit % 2 === 0
            : exitDigit % 2 !== 0;

      const stake = currentStake;
      if (stake > maxStakeUsed) maxStakeUsed = stake;

      const pnl = won ? Number((stake * safeYield).toFixed(2)) : Number((-stake).toFixed(2));

      if (won) {
        wins += 1;
        grossProfit += pnl;
        consecutiveLosses = 0;
        cumulativeLoss = 0;
        currentStake = baseStake;
      } else {
        losses += 1;
        grossLoss += Math.abs(pnl);
        consecutiveLosses += 1;
        if (consecutiveLosses > maxConsecutiveLosses) {
          maxConsecutiveLosses = consecutiveLosses;
        }
        cumulativeLoss += stake;
        if (config.useRecovery) {
          const targetProfit = baseStake * safeYield;
          const preciseRecoveryStake = (cumulativeLoss + targetProfit) / safeYield;
          currentStake = Math.ceil(preciseRecoveryStake * 100) / 100;
        } else {
          currentStake = baseStake;
        }
      }

      equity = Number((equity + pnl).toFixed(2));
      if (equity > peakEquity) {
        peakEquity = equity;
      }
      const drawdown = Number(Math.max(0, peakEquity - equity).toFixed(2));
      if (drawdown > maxDrawdown) {
        maxDrawdown = drawdown;
      }

      const tradeNum = wins + losses;
      fullCurve.push({
        tradeIndex: tradeNum,
        tickIndex: exitIdx,
        equity,
        drawdown,
      });

      const startSlice = Math.max(0, i - targetStreak + 1);
      allTrades.push({
        index: tradeNum,
        tickIndex: exitIdx,
        timestamp: times[exitIdx] ? times[exitIdx] * 1000 : 0,
        contractType,
        triggerDigits: digits.slice(startSlice, i + 1),
        exitDigit,
        stake,
        won,
        pnl,
        equityAfter: equity,
        drawdownAfter: drawdown,
      });

      // Advance past settlement tick & reset streaks on the consumed settlement tick cleanly
      over1Streak = 0;
      evenStreak = 0;
      oddStreak = 0;
      i = exitIdx;
    }
  }

  const totalTrades = wins + losses;
  const winRate = totalTrades > 0 ? (wins / totalTrades) * 100 : 0;
  const netPnL = Number(equity.toFixed(2));
  const profitFactor =
    grossLoss > 0 ? Number((grossProfit / grossLoss).toFixed(2)) : grossProfit > 0 ? 99.9 : 0;
  const recoveryFactor =
    maxDrawdown > 0 ? Number((netPnL / maxDrawdown).toFixed(2)) : netPnL > 0 ? 10 : 0;

  // Drawdown as % of peak working bankroll (baseStake*20 reference + peakEquity)
  const referenceCapital = Math.max(baseStake * 25, peakEquity + baseStake * 10);
  const maxDrawdownPct = Number(Math.min(100, (maxDrawdown / referenceCapital) * 100).toFixed(1));

  // Drawdown-first composite score (0-100):
  // Heavily rewards low maxDrawdown, low consecutive losses, low maxStakeUsed, and positive risk-adjusted return.
  let riskScore = 50;
  if (totalTrades === 0) {
    riskScore = 0;
  } else {
    const ddMultiple = maxDrawdown / baseStake;
    const stakeMultiple = maxStakeUsed / baseStake;
    const ddPenalty = Math.min(48, ddMultiple * 1.4);
    const streakPenalty = Math.min(28, maxConsecutiveLosses * 4.5);
    const stakePenalty = Math.min(18, Math.max(0, stakeMultiple - 1) * 0.45);
    const returnBonus = Math.max(-20, Math.min(25, (netPnL / Math.max(baseStake, maxDrawdown || baseStake)) * 8));
    const pfBonus = Math.min(14, Math.max(0, (profitFactor - 1) * 10));
    const activityBonus = Math.min(8, totalTrades >= 8 ? 8 : totalTrades);

    riskScore = Math.max(
      0,
      Math.min(100, Number((58 + returnBonus + pfBonus + activityBonus - ddPenalty - streakPenalty - stakePenalty).toFixed(1)))
    );
  }

  let riskTier: 'LOW' | 'MODERATE' | 'ELEVATED' | 'HIGH' = 'MODERATE';
  if (totalTrades === 0) {
    riskTier = 'MODERATE';
  } else if (maxDrawdown <= baseStake * 6 && maxConsecutiveLosses <= 3 && netPnL >= 0) {
    riskTier = 'LOW';
  } else if (maxDrawdown <= baseStake * 16 && maxConsecutiveLosses <= 5 && netPnL >= -baseStake * 2) {
    riskTier = 'MODERATE';
  } else if (maxDrawdown <= baseStake * 35 && maxConsecutiveLosses <= 7) {
    riskTier = 'ELEVATED';
  } else {
    riskTier = 'HIGH';
  }

  return {
    symbol: series.symbol,
    name: series.name,
    shortName: series.shortName,
    tickCount: digits.length,
    timespanMinutes: Number(timespanMinutes.toFixed(1)),
    totalTrades,
    wins,
    losses,
    winRate: Number(winRate.toFixed(1)),
    netPnL,
    grossProfit: Number(grossProfit.toFixed(2)),
    grossLoss: Number(grossLoss.toFixed(2)),
    profitFactor,
    maxDrawdown: Number(maxDrawdown.toFixed(2)),
    maxDrawdownPct,
    recoveryFactor,
    maxConsecutiveLosses,
    maxStakeUsed: Number(maxStakeUsed.toFixed(2)),
    longestTriggerStreak,
    digitCounts,
    evenPct: Number(((evenCount / n) * 100).toFixed(1)),
    oddPct: Number(((oddCount / n) * 100).toFixed(1)),
    lowDigitPct: Number(((lowDigitCount / n) * 100).toFixed(1)),
    riskScore,
    riskTier,
    equityCurve: downsampleCurve(fullCurve, 90),
    recentTrades: allTrades.slice(-100).reverse(),
  };
}

export function runBacktestSuite(
  seriesList: MarketTickSeries[],
  config: BacktestConfig
): MarketBacktestResult[] {
  const results = seriesList.map((s) => simulateMarketBacktest(s, config));
  return results.sort((a, b) => {
    if (b.riskScore !== a.riskScore) return b.riskScore - a.riskScore;
    if (a.maxDrawdown !== b.maxDrawdown) return a.maxDrawdown - b.maxDrawdown;
    return b.netPnL - a.netPnL;
  });
}
