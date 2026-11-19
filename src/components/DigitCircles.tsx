import React, { useEffect, useMemo, useRef, useState } from 'react';
import { RefreshCw, AlertTriangle, Crosshair, Check } from 'lucide-react';
import {
  ALL_MARKET_SYMBOLS,
  SYNTHETIC_MARKET_CATALOG,
  useStore,
} from '../store/useStore';
import { evaluateDCirclesSignal } from '../utils/dCirclesStrategy';

const PUBLIC_WS_URL = 'wss://api.derivws.com/trading/v1/options/ws/public';
const WINDOW_SIZE = 5000;
const RECENT_TAPE_SIZE = 30;

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

function extractLastDigit(rawPrice: string | number, pipSize: number): number {
  const num = typeof rawPrice === 'number' ? rawPrice : Number(rawPrice);
  if (!Number.isFinite(num)) return 0;
  return Math.abs(Math.round(num * Math.pow(10, pipSize))) % 10;
}

interface CircleSnapshot {
  counts: number[];
  totalTicks: number;
  latestPrice: number | null;
  latestDigit: number | null;
  pipSize: number;
  recentDigits: number[];
  tickSeq: number;
  lastUpdatedAt: number | null;
}

const EMPTY_SNAPSHOT: CircleSnapshot = {
  counts: Array(10).fill(0),
  totalTicks: 0,
  latestPrice: null,
  latestDigit: null,
  pipSize: 2,
  recentDigits: [],
  tickSeq: 0,
  lastUpdatedAt: null,
};

export function DigitCircles() {
  const selectedSymbol = useStore((state) => state.dCirclesSymbol);
  const setSelectedSymbol = useStore((state) => state.setDCirclesSymbol);
  const settings = useStore((state) => state.settings);
  const setSelectedMarkets = useStore((state) => state.setSelectedMarkets);
  const setSubscribedMarkets = useStore((state) => state.setSubscribedMarkets);

  const [snapshot, setSnapshot] = useState<CircleSnapshot>(EMPTY_SNAPSHOT);
  const [status, setStatus] = useState<'loading' | 'streaming' | 'error'>('loading');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [focusedFeedback, setFocusedFeedback] = useState(false);

  // Rolling 5,000-tick ring buffer kept in ref for O(1) live updates
  const engineRef = useRef<{
    buffer: Uint8Array;
    length: number;
    writeIdx: number;
    counts: number[];
    pipSize: number;
    lastHistoryEpoch: number | null;
    lastHistoryPrice: number | null;
    checkedFirstOverlap: boolean;
    recentDigits: number[];
    tickSeq: number;
  }>({
    buffer: new Uint8Array(WINDOW_SIZE),
    length: 0,
    writeIdx: 0,
    counts: Array(10).fill(0),
    pipSize: 2,
    lastHistoryEpoch: null,
    lastHistoryPrice: null,
    checkedFirstOverlap: false,
    recentDigits: [],
    tickSeq: 0,
  });

  useEffect(() => {
    let isCancelled = false;
    let ws: WebSocket | null = null;
    let pingInterval: ReturnType<typeof setInterval> | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let historyTimeout: ReturnType<typeof setTimeout> | null = null;

    const resetEngine = (pipSize: number) => {
      engineRef.current = {
        buffer: new Uint8Array(WINDOW_SIZE),
        length: 0,
        writeIdx: 0,
        counts: Array(10).fill(0),
        pipSize,
        lastHistoryEpoch: null,
        lastHistoryPrice: null,
        checkedFirstOverlap: false,
        recentDigits: [],
        tickSeq: 0,
      };
    };

    const defaultPip = DEFAULT_PIP_SIZES[selectedSymbol] ?? 2;
    resetEngine(defaultPip);
    setSnapshot({ ...EMPTY_SNAPSHOT, pipSize: defaultPip });
    setStatus('loading');
    setErrorMessage(null);

    const connect = () => {
      if (isCancelled) return;
      setStatus('loading');
      setErrorMessage(null);

      try {
        ws = new WebSocket(PUBLIC_WS_URL);
      } catch (err: any) {
        setStatus('error');
        setErrorMessage(err?.message || 'Unable to open Deriv market stream.');
        return;
      }

      const historyReqId = Date.now() % 1000000;
      const streamReqId = historyReqId + 1;
      let historyReceived = false;
      const queuedTicks: any[] = [];

      const applyLiveTick = (tick: any) => {
        if (!tick || tick.symbol !== selectedSymbol) return;
        const eng = engineRef.current;
        const price = Number(tick.quote);
        if (!Number.isFinite(price)) return;

        const epoch = typeof tick.epoch === 'number' ? tick.epoch : null;
        if (!eng.checkedFirstOverlap && eng.lastHistoryEpoch !== null && epoch !== null) {
          eng.checkedFirstOverlap = true;
          if (epoch < eng.lastHistoryEpoch || (epoch === eng.lastHistoryEpoch && price === eng.lastHistoryPrice)) {
            return;
          }
        } else {
          eng.checkedFirstOverlap = true;
        }

        const pipSize =
          typeof tick.pip_size === 'number' ? tick.pip_size : eng.pipSize;
        const digit = extractLastDigit(tick.quote, pipSize);

        if (eng.length < WINDOW_SIZE) {
          eng.buffer[eng.length] = digit;
          eng.length += 1;
          eng.counts[digit] += 1;
          if (eng.length === WINDOW_SIZE) {
            eng.writeIdx = 0;
          }
        } else {
          const evicted = eng.buffer[eng.writeIdx];
          if (eng.counts[evicted] > 0) {
            eng.counts[evicted] -= 1;
          }
          eng.buffer[eng.writeIdx] = digit;
          eng.writeIdx = (eng.writeIdx + 1) % WINDOW_SIZE;
          eng.counts[digit] += 1;
        }

        eng.pipSize = pipSize;
        eng.tickSeq += 1;
        eng.recentDigits = [digit, ...eng.recentDigits].slice(0, RECENT_TAPE_SIZE);

        setSnapshot({
          counts: [...eng.counts],
          totalTicks: eng.length,
          latestPrice: price,
          latestDigit: digit,
          pipSize,
          recentDigits: eng.recentDigits,
          tickSeq: eng.tickSeq,
          lastUpdatedAt: Date.now(),
        });
      };

      ws.onopen = () => {
        if (isCancelled || !ws) return;

        if (pingInterval) clearInterval(pingInterval);
        pingInterval = setInterval(() => {
          if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send('{"ping":1}');
          }
        }, 15000);

        historyTimeout = setTimeout(() => {
          if (!isCancelled && !historyReceived) {
            setStatus('error');
            setErrorMessage('Timed out loading the last 5,000 ticks. Please refresh.');
          }
        }, 18000);

        ws.send(
          JSON.stringify({
            ticks_history: selectedSymbol,
            adjust_start_time: 1,
            count: WINDOW_SIZE,
            end: 'latest',
            style: 'ticks',
            req_id: historyReqId,
          })
        );

        ws.send(
          JSON.stringify({
            ticks: selectedSymbol,
            subscribe: 1,
            req_id: streamReqId,
          })
        );
      };

      ws.onmessage = (event) => {
        if (isCancelled) return;
        let data: any;
        try {
          data = JSON.parse(event.data);
        } catch {
          return;
        }

        if (data.error) {
          if (historyTimeout) clearTimeout(historyTimeout);
          setStatus('error');
          setErrorMessage(data.error.message || 'Deriv WebSocket error.');
          return;
        }

        if (data.msg_type === 'history' && data.history) {
          if (historyTimeout) clearTimeout(historyTimeout);
          historyReceived = true;

          const rawPrices: Array<number | string> = data.history.prices || [];
          const rawTimes: number[] = data.history.times || [];
          const pipSize =
            typeof data.pip_size === 'number'
              ? data.pip_size
              : DEFAULT_PIP_SIZES[selectedSymbol] ?? 2;

          const sliceStart = Math.max(0, rawPrices.length - WINDOW_SIZE);
          const slicedPrices = rawPrices.slice(sliceStart);
          const slicedTimes = rawTimes.slice(sliceStart);

          resetEngine(pipSize);
          const eng = engineRef.current;

          for (let i = 0; i < slicedPrices.length; i++) {
            const d = extractLastDigit(slicedPrices[i], pipSize);
            eng.buffer[i] = d;
            eng.counts[d] += 1;
          }

          eng.length = slicedPrices.length;
          eng.writeIdx = eng.length === WINDOW_SIZE ? 0 : eng.length;

          const lastIdx = slicedPrices.length - 1;
          const latestPrice = lastIdx >= 0 ? Number(slicedPrices[lastIdx]) : null;
          const latestDigit =
            lastIdx >= 0 ? eng.buffer[lastIdx] : null;
          eng.lastHistoryEpoch =
            lastIdx >= 0 && typeof slicedTimes[lastIdx] === 'number'
              ? slicedTimes[lastIdx]
              : null;
          eng.lastHistoryPrice = latestPrice;

          const recent: number[] = [];
          for (let i = lastIdx; i >= 0 && recent.length < RECENT_TAPE_SIZE; i--) {
            recent.push(eng.buffer[i]);
          }
          eng.recentDigits = recent;

          setSnapshot({
            counts: [...eng.counts],
            totalTicks: eng.length,
            latestPrice,
            latestDigit,
            pipSize,
            recentDigits: eng.recentDigits,
            tickSeq: 0,
            lastUpdatedAt: Date.now(),
          });
          setStatus('streaming');

          if (queuedTicks.length > 0) {
            for (const qTick of queuedTicks) {
              applyLiveTick(qTick);
            }
            queuedTicks.length = 0;
          }
        } else if (data.msg_type === 'tick' && data.tick) {
          if (!historyReceived) {
            queuedTicks.push(data.tick);
          } else {
            applyLiveTick(data.tick);
          }
        }
      };

      ws.onerror = () => {
        if (!isCancelled && !historyReceived) {
          setStatus('error');
          setErrorMessage('Connection error while streaming market ticks.');
        }
      };

      ws.onclose = () => {
        if (pingInterval) clearInterval(pingInterval);
        if (historyTimeout) clearTimeout(historyTimeout);
        if (!isCancelled) {
          reconnectTimer = setTimeout(connect, 2000);
        }
      };
    };

    connect();

    return () => {
      isCancelled = true;
      if (pingInterval) clearInterval(pingInterval);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (historyTimeout) clearTimeout(historyTimeout);
      if (ws) {
        try {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send('{"forget_all":"ticks"}');
          }
          ws.close();
        } catch {
          // ignore close errors
        }
      }
    };
  }, [selectedSymbol, reloadKey]);

  const marketMeta = useMemo(
    () =>
      SYNTHETIC_MARKET_CATALOG.find((m) => m.symbol === selectedSymbol) || {
        symbol: selectedSymbol,
        name: selectedSymbol,
        shortName: selectedSymbol,
        group: 'volatility' as const,
      },
    [selectedSymbol]
  );

  const stats = useMemo(() => {
    const { counts, totalTicks } = snapshot;
    const maxCount = Math.max(...counts);
    const minCount = Math.min(...counts);
    const hasSpread = totalTicks > 0 && maxCount > minCount;

    const mostDigits = hasSpread
      ? counts
          .map((c, d) => (c === maxCount ? d : -1))
          .filter((d) => d !== -1)
      : [];
    const leastDigits = hasSpread
      ? counts
          .map((c, d) => (c === minCount ? d : -1))
          .filter((d) => d !== -1)
      : [];

    let evenCount = 0;
    let oddCount = 0;
    let lowCount = 0;
    let over1Count = 0;

    counts.forEach((c, d) => {
      if (d % 2 === 0) evenCount += c;
      else oddCount += c;
      if (d === 0 || d === 1) lowCount += c;
      else over1Count += c;
    });

    const denom = totalTicks || 1;
    const maxPct = totalTicks > 0 ? (maxCount / denom) * 100 : 10;
    const minPct = totalTicks > 0 ? (minCount / denom) * 100 : 10;

    const signal = totalTicks > 0 ? evaluateDCirclesSignal(counts) : null;

    return {
      maxCount,
      minCount,
      maxPct,
      minPct,
      hasSpread,
      mostDigits,
      leastDigits,
      signal,
      evenPct: (evenCount / denom) * 100,
      oddPct: (oddCount / denom) * 100,
      over1Pct: (over1Count / denom) * 100,
      lowPct: (lowCount / denom) * 100,
    };
  }, [snapshot]);

  const isOnlySelectedForBot =
    Array.isArray(settings.selectedMarkets) &&
    settings.selectedMarkets.length === 1 &&
    settings.selectedMarkets[0] === selectedSymbol;

  const handleFocusBotOnMarket = () => {
    const currentSub = Array.isArray(settings.subscribedMarkets)
      ? settings.subscribedMarkets
      : [...ALL_MARKET_SYMBOLS];
    if (!currentSub.includes(selectedSymbol)) {
      setSubscribedMarkets([...currentSub, selectedSymbol]);
    }
    setSelectedMarkets([selectedSymbol]);
    setFocusedFeedback(true);
    setTimeout(() => setFocusedFeedback(false), 2500);
  };

  const radius = 44;
  const circumference = 2 * Math.PI * radius;

  return (
    <div className="space-y-4 max-w-5xl mx-auto">
      {/* Single-Market Selector & Live Stream Header */}
      <div className="bg-[#111114] border border-[#27272a] rounded-lg p-4 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-sm sm:text-base font-bold text-[#e4e4e7]">
              Digit Circles
            </h1>
            <div className="flex flex-wrap items-center gap-2 text-xs text-[#a1a1aa] font-mono mt-0.5 tabular-nums">
              <span>{marketMeta.name}</span>
              <span aria-hidden="true">·</span>
              <span>
                {snapshot.totalTicks > 0
                  ? `${snapshot.totalTicks.toLocaleString()} rolling ticks`
                  : 'Loading 5,000 ticks'}
              </span>
              {status === 'streaming' && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="inline-flex items-center gap-1.5 text-[#00ff9c]">
                    <span className="w-1.5 h-1.5 rounded-full bg-[#00ff9c]" />
                    Live
                  </span>
                </>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <label htmlFor="dcircles-market-select" className="sr-only">
              Select market for Digit Circles
            </label>
            <select
              id="dcircles-market-select"
              value={selectedSymbol}
              onChange={(e) => setSelectedSymbol(e.target.value)}
              className="bg-[#18181b] border border-[#27272a] hover:border-[#3f3f46] rounded-md px-3 py-2 text-xs font-mono font-semibold text-[#e4e4e7] outline-none focus:border-[#00ff9c] cursor-pointer"
            >
              <optgroup label="Volatility Indices">
                {SYNTHETIC_MARKET_CATALOG.filter((m) => m.group === 'volatility').map((m) => (
                  <option key={m.symbol} value={m.symbol}>
                    {m.name} ({m.symbol})
                  </option>
                ))}
              </optgroup>
              <optgroup label="Volatility (1s) Indices">
                {SYNTHETIC_MARKET_CATALOG.filter((m) => m.group === '1s').map((m) => (
                  <option key={m.symbol} value={m.symbol}>
                    {m.name} ({m.symbol})
                  </option>
                ))}
              </optgroup>
              <optgroup label="Jump Indices">
                {SYNTHETIC_MARKET_CATALOG.filter((m) => m.group === 'jump').map((m) => (
                  <option key={m.symbol} value={m.symbol}>
                    {m.name} ({m.symbol})
                  </option>
                ))}
              </optgroup>
              <optgroup label="Daily Reset Indices">
                {SYNTHETIC_MARKET_CATALOG.filter((m) => m.group === 'daily').map((m) => (
                  <option key={m.symbol} value={m.symbol}>
                    {m.name} ({m.symbol})
                  </option>
                ))}
              </optgroup>
            </select>

            <button
              type="button"
              onClick={() => setReloadKey((k) => k + 1)}
              disabled={status === 'loading'}
              title="Re-fetch last 5,000 ticks"
              className="px-3 py-2 rounded-md border border-[#27272a] bg-white/5 hover:border-[#3f3f46] text-[#e4e4e7] disabled:opacity-50 text-xs font-mono font-semibold flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <RefreshCw size={12} className={status === 'loading' ? 'animate-spin' : ''} />
              <span>Refresh</span>
            </button>

            <button
              type="button"
              onClick={handleFocusBotOnMarket}
              className={`px-3 py-2 rounded-md border text-xs font-mono font-semibold flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                focusedFeedback || isOnlySelectedForBot
                  ? 'bg-[#00ff9c]/15 border-[#00ff9c]/40 text-[#00ff9c]'
                  : 'bg-[#00ff9c] border-[#00ff9c] text-[#09090b] hover:opacity-90'
              }`}
            >
              {focusedFeedback || isOnlySelectedForBot ? (
                <>
                  <Check size={12} strokeWidth={3} />
                  <span>{focusedFeedback ? 'Bot Focused' : 'Bot Trading Only This'}</span>
                </>
              ) : (
                <>
                  <Crosshair size={12} />
                  <span>Trade Only {selectedSymbol}</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Live Quote & 5K Analytical Breakdown Strip */}
        <div className="pt-3 border-t border-[#27272a] grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 font-mono">
          <div>
            <div className="text-[11px] text-[#71717a]">Live Price</div>
            <div className="text-sm sm:text-base font-bold text-[#e4e4e7] tabular-nums mt-0.5 flex items-baseline gap-2">
              <span>
                {snapshot.latestPrice !== null
                  ? snapshot.latestPrice.toFixed(snapshot.pipSize)
                  : '---.----'}
              </span>
              {snapshot.latestDigit !== null && (
                <span className="text-xs text-[#38bdf8]">
                  Digit {snapshot.latestDigit}
                </span>
              )}
            </div>
          </div>

          <div>
            <div className="text-[11px] text-[#71717a]">Most Appearing</div>
            <div className="text-sm sm:text-base font-bold text-[#00ff9c] tabular-nums mt-0.5">
              {stats.mostDigits.length > 0
                ? `${stats.mostDigits.join(', ')} · ${stats.maxPct.toFixed(2)}%`
                : '—'}
            </div>
            {stats.mostDigits.length > 0 && (
              <div className="text-[11px] text-[#a1a1aa] tabular-nums">
                {stats.maxCount.toLocaleString()} hits
              </div>
            )}
          </div>

          <div>
            <div className="text-[11px] text-[#71717a]">Least Appearing</div>
            <div className="text-sm sm:text-base font-bold text-[#ff4b4b] tabular-nums mt-0.5">
              {stats.leastDigits.length > 0
                ? `${stats.leastDigits.join(', ')} · ${stats.minPct.toFixed(2)}%`
                : '—'}
            </div>
            {stats.leastDigits.length > 0 && (
              <div className="text-[11px] text-[#a1a1aa] tabular-nums">
                {stats.minCount.toLocaleString()} hits
              </div>
            )}
          </div>

          <div>
            <div className="text-[11px] text-[#71717a]">D-Circles Entry</div>
            {stats.signal?.direction ? (
              <>
                <div
                  className={`text-sm sm:text-base font-bold tabular-nums mt-0.5 ${
                    stats.signal.direction === 'EVEN' ? 'text-[#38bdf8]' : 'text-[#ffb000]'
                  }`}
                >
                  Trade {stats.signal.direction}
                </div>
                <div className="text-[11px] text-[#a1a1aa] tabular-nums">
                  Trigger: {stats.signal.triggerDigits.join(', ')}
                </div>
              </>
            ) : (
              <>
                <div className="text-sm sm:text-base font-bold text-[#71717a] mt-0.5">
                  Wait
                </div>
                <div className="text-[11px] text-[#71717a]">Mixed parity</div>
              </>
            )}
          </div>

          <div>
            <div className="text-[11px] text-[#71717a]">Even / Odd (5K)</div>
            <div className="text-xs sm:text-sm font-bold text-[#e4e4e7] tabular-nums mt-1">
              <span className="text-[#38bdf8]">{stats.evenPct.toFixed(1)}%</span>
              <span className="text-[#52525b] mx-1">/</span>
              <span className="text-[#ffb000]">{stats.oddPct.toFixed(1)}%</span>
            </div>
          </div>

          <div>
            <div className="text-[11px] text-[#71717a]">Over 1 / 0–1 (5K)</div>
            <div className="text-xs sm:text-sm font-bold text-[#e4e4e7] tabular-nums mt-1">
              <span className="text-[#00ff9c]">{stats.over1Pct.toFixed(1)}%</span>
              <span className="text-[#52525b] mx-1">/</span>
              <span className="text-[#ff4b4b]">{stats.lowPct.toFixed(1)}%</span>
            </div>
          </div>
        </div>
      </div>

      {status === 'error' && errorMessage && (
        <div className="flex items-center justify-between gap-3 bg-[#ff4b4b]/10 border border-[#ff4b4b]/30 text-[#ff4b4b] px-4 py-3 rounded-lg text-xs font-mono">
          <div className="flex items-center gap-2">
            <AlertTriangle size={14} className="shrink-0" />
            <span>{errorMessage}</span>
          </div>
          <button
            type="button"
            onClick={() => setReloadKey((k) => k + 1)}
            className="px-3 py-1 rounded bg-[#ff4b4b]/20 hover:bg-[#ff4b4b]/30 font-bold cursor-pointer shrink-0"
          >
            Retry
          </button>
        </div>
      )}

      {/* 10 Digit Circles Grid (0 - 9) */}
      <div className="bg-[#111114] border border-[#27272a] rounded-lg p-4 sm:p-5">
        {status === 'loading' && snapshot.totalTicks === 0 ? (
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 sm:gap-4">
            {Array.from({ length: 10 }).map((_, d) => (
              <div
                key={d}
                className="flex flex-col items-center justify-center py-4 rounded-lg border border-[#27272a] bg-black/20 animate-pulse"
              >
                <div className="w-24 h-24 rounded-full border-4 border-[#27272a] flex items-center justify-center font-mono text-xl font-bold text-[#52525b]">
                  {d}
                </div>
                <div className="h-3 w-12 bg-[#27272a] rounded mt-2.5" />
              </div>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 sm:gap-4">
            {snapshot.counts.map((count, digit) => {
              const pct = snapshot.totalTicks > 0 ? (count / snapshot.totalTicks) * 100 : 0;
              const isMost = stats.hasSpread && count === stats.maxCount;
              const isLeast = stats.hasSpread && count === stats.minCount;
              const isLatest = snapshot.latestDigit === digit;

              // Normalize gauge arc so 7%–13% spreads visually read clearly on the ring
              const gaugeScaleMax = Math.max(15, stats.maxPct * 1.15);
              const fillRatio = snapshot.totalTicks > 0 ? Math.min(1, Math.max(0.08, pct / gaugeScaleMax)) : 0;
              const dashOffset = circumference * (1 - fillRatio);

              const ringStroke = isMost
                ? '#00ff9c'
                : isLeast
                  ? '#ff4b4b'
                  : isLatest
                    ? '#38bdf8'
                    : '#71717a';

              const cardBorder = isLatest
                ? isMost
                  ? 'border-[#00ff9c] ring-1 ring-[#38bdf8]/70 bg-[#00ff9c]/[0.06]'
                  : isLeast
                    ? 'border-[#ff4b4b] ring-1 ring-[#38bdf8]/70 bg-[#ff4b4b]/[0.06]'
                    : 'border-[#38bdf8] bg-[#38bdf8]/[0.05]'
                : isMost
                  ? 'border-[#00ff9c]/60 bg-[#00ff9c]/[0.04]'
                  : isLeast
                    ? 'border-[#ff4b4b]/60 bg-[#ff4b4b]/[0.04]'
                    : 'border-[#27272a] bg-black/20';

              const digitColor = isMost
                ? 'text-[#00ff9c]'
                : isLeast
                  ? 'text-[#ff4b4b]'
                  : isLatest
                    ? 'text-[#38bdf8]'
                    : 'text-[#e4e4e7]';

              return (
                <div
                  key={digit}
                  className={`relative flex flex-col items-center justify-center py-3.5 px-2 rounded-lg border transition-colors ${cardBorder}`}
                >
                  <div className="relative w-24 h-24 sm:w-28 sm:h-28 flex items-center justify-center">
                    <svg
                      viewBox="0 0 112 112"
                      className="w-full h-full -rotate-90"
                      aria-hidden="true"
                    >
                      <circle
                        cx="56"
                        cy="56"
                        r={radius}
                        fill="none"
                        stroke="#27272a"
                        strokeWidth="6"
                      />
                      <circle
                        cx="56"
                        cy="56"
                        r={radius}
                        fill="none"
                        stroke={ringStroke}
                        strokeWidth={isMost || isLeast || isLatest ? '7' : '5.5'}
                        strokeLinecap="round"
                        strokeDasharray={circumference}
                        strokeDashoffset={dashOffset}
                        className="transition-[stroke-dashoffset] duration-150"
                      />
                    </svg>

                    <div className="absolute inset-0 flex flex-col items-center justify-center font-mono">
                      <span className={`text-2xl sm:text-3xl font-extrabold leading-none tabular-nums ${digitColor}`}>
                        {digit}
                      </span>
                      <span className={`text-[11px] sm:text-xs font-bold tabular-nums mt-1 ${digitColor}`}>
                        {pct.toFixed(1)}%
                      </span>
                    </div>
                  </div>

                  <div className="mt-2 text-center font-mono space-y-0.5">
                    <div className="text-[11px] text-[#a1a1aa] tabular-nums">
                      {count.toLocaleString()} ticks
                    </div>
                    <div className="h-4 flex items-center justify-center gap-1.5 text-[10px] font-bold uppercase tracking-wider">
                      {isMost && <span className="text-[#00ff9c]">Most</span>}
                      {isLeast && <span className="text-[#ff4b4b]">Least</span>}
                      {isLatest && (
                        <span className="text-[#38bdf8]">
                          {isMost || isLeast ? '· Live' : 'Live'}
                        </span>
                      )}
                      {!isMost && !isLeast && !isLatest && (
                        <span className="text-[#52525b]">Avg 10%</span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Live Incoming Digit Sequence */}
      {snapshot.recentDigits.length > 0 && (
        <div className="bg-[#111114] border border-[#27272a] rounded-lg p-4 space-y-2.5">
          <div className="flex items-center justify-between text-xs font-mono">
            <span className="font-semibold text-[#e4e4e7]">
              Latest Incoming Digits ({selectedSymbol})
            </span>
            <span className="text-[#71717a] tabular-nums">
              Newest on left · Window {snapshot.totalTicks.toLocaleString()} ticks
            </span>
          </div>
          <div className="flex flex-wrap gap-1.5 font-mono">
            {snapshot.recentDigits.map((d, idx) => {
              const count = snapshot.counts[d] ?? 0;
              const isMost = stats.hasSpread && count === stats.maxCount;
              const isLeast = stats.hasSpread && count === stats.minCount;
              const isNewest = idx === 0;

              return (
                <div
                  key={`${snapshot.tickSeq}-${idx}`}
                  className={`w-7 h-7 rounded border flex items-center justify-center text-xs font-bold tabular-nums ${
                    isNewest
                      ? 'border-[#38bdf8] bg-[#38bdf8]/15 text-[#38bdf8]'
                      : isMost
                        ? 'border-[#00ff9c]/40 bg-[#00ff9c]/10 text-[#00ff9c]'
                        : isLeast
                          ? 'border-[#ff4b4b]/40 bg-[#ff4b4b]/10 text-[#ff4b4b]'
                          : 'border-[#27272a] bg-black/30 text-[#a1a1aa]'
                  }`}
                >
                  {d}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
