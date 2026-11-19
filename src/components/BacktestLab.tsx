import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Bot,
  Check,
  ChevronDown,
  ChevronUp,
  Play,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  X,
} from 'lucide-react';
import {
  ALL_MARKET_SYMBOLS,
  EvenOddMode,
  StrategyType,
  useStore,
} from '../store/useStore';
import {
  BacktestConfig,
  EquityPoint,
  FetchProgress,
  MarketBacktestResult,
  MarketTickSeries,
  fetchMarketsTickHistory,
  runBacktestSuite,
} from '../utils/backtestEngine';

interface BacktestAIAnalysis {
  executiveSummary: string;
  bestMarketSymbol: string;
  recommendedMarkets: Array<{
    symbol: string;
    riskTier: 'LOW' | 'MEDIUM' | 'HIGH';
    rationale: string;
  }>;
  avoidMarkets: Array<{
    symbol: string;
    reason: string;
  }>;
  parameterGuidance: string;
  minSafeBankrollUsd: number;
}

function EquitySparkline({ curve, netPnL }: { curve: EquityPoint[]; netPnL: number }) {
  if (!curve || curve.length < 2) {
    return <span className="text-[10px] text-[#52525b] font-mono">—</span>;
  }
  const width = 84;
  const height = 22;
  const values = curve.map((p) => p.equity);
  const min = Math.min(0, ...values);
  const max = Math.max(0, ...values);
  const span = max - min || 1;

  const points = curve
    .map((p, idx) => {
      const x = (idx / (curve.length - 1)) * width;
      const y = height - 2 - ((p.equity - min) / span) * (height - 4);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  const stroke = netPnL >= 0 ? '#00ff9c' : '#ff4b4b';

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="overflow-visible">
      <polyline fill="none" stroke={stroke} strokeWidth={1.6} points={points} />
    </svg>
  );
}

function MarketChart({ result }: { result: MarketBacktestResult }) {
  const curve = result.equityCurve;
  if (!curve || curve.length < 2) {
    return (
      <div className="h-36 flex items-center justify-center border border-[#27272a] rounded bg-black/30 text-xs font-mono text-[#71717a]">
        No trades triggered at this streak setting.
      </div>
    );
  }

  const width = 640;
  const height = 140;
  const padX = 8;
  const padY = 10;

  const equities = curve.map((c) => c.equity);
  const drawdowns = curve.map((c) => -c.drawdown);
  const minVal = Math.min(0, ...equities, ...drawdowns);
  const maxVal = Math.max(0, ...equities);
  const span = maxVal - minVal || 1;

  const toX = (idx: number) => padX + (idx / (curve.length - 1)) * (width - padX * 2);
  const toY = (val: number) =>
    height - padY - ((val - minVal) / span) * (height - padY * 2);

  const zeroY = toY(0);
  const eqPoints = curve.map((p, idx) => `${toX(idx).toFixed(1)},${toY(p.equity).toFixed(1)}`).join(' ');
  const ddAreaPoints = [
    `${toX(0).toFixed(1)},${zeroY.toFixed(1)}`,
    ...curve.map((p, idx) => `${toX(idx).toFixed(1)},${toY(-p.drawdown).toFixed(1)}`),
    `${toX(curve.length - 1).toFixed(1)},${zeroY.toFixed(1)}`,
  ].join(' ');

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-36">
      <line
        x1={padX}
        y1={zeroY}
        x2={width - padX}
        y2={zeroY}
        stroke="#3f3f46"
        strokeWidth={1}
        strokeDasharray="3 3"
      />
      <polygon points={ddAreaPoints} fill="rgba(255, 75, 75, 0.18)" />
      <polyline
        fill="none"
        stroke={result.netPnL >= 0 ? '#00ff9c' : '#ffb000'}
        strokeWidth={2}
        points={eqPoints}
      />
    </svg>
  );
}

export function BacktestLab() {
  const settings = useStore((state) => state.settings);
  const setSettings = useStore((state) => state.setSettings);
  const toggleMarketSelection = useStore((state) => state.toggleMarketSelection);
  const setSelectedMarkets = useStore((state) => state.setSelectedMarkets);

  const [config, setConfig] = useState<BacktestConfig>({
    strategy:
      settings.strategy === 'EVEN_ODD' || settings.strategy === 'DCIRCLES_EVEN_ODD'
        ? settings.strategy
        : 'DIGIT_OVER',
    evenOddMode: settings.evenOddMode || 'reversal',
    targetStreak: settings.targetStreak || 3,
    baseStake: settings.globalStake || 1,
    useRecovery: true,
    tickCount: 5000,
  });

  const [tickCache, setTickCache] = useState<MarketTickSeries[]>([]);
  const [isFetching, setIsFetching] = useState(false);
  const [fetchProgress, setFetchProgress] = useState<FetchProgress | null>(null);
  const [fetchErrorBanner, setFetchErrorBanner] = useState<string | null>(null);

  const [showAllMarkets, setShowAllMarkets] = useState(false);
  const [inspectedSymbol, setInspectedSymbol] = useState<string | null>(null);

  const [aiAnalysis, setAiAnalysis] = useState<BacktestAIAnalysis | null>(null);
  const [isAnalyzingAI, setIsAnalyzingAI] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [appliedBanner, setAppliedBanner] = useState<string | null>(null);

  // Instant re-simulation when parameters change on cached 5,000-tick data
  const rankedResults = useMemo(() => {
    if (tickCache.length === 0) return [];
    return runBacktestSuite(tickCache, config);
  }, [tickCache, config]);

  // Show only the top 5 best low-drawdown markets by default
  const displayedResults = useMemo(() => {
    if (showAllMarkets) return rankedResults;
    return rankedResults.slice(0, 5);
  }, [rankedResults, showAllMarkets]);

  const inspectedResult = useMemo(() => {
    if (!inspectedSymbol) return null;
    return rankedResults.find((r) => r.symbol === inspectedSymbol) || null;
  }, [rankedResults, inspectedSymbol]);

  const selectedLiveMarkets = Array.isArray(settings.selectedMarkets)
    ? settings.selectedMarkets
    : [...ALL_MARKET_SYMBOLS];

  const triggerAIAnalysis = async (
    targetResults: MarketBacktestResult[],
    targetConfig: BacktestConfig
  ) => {
    if (targetResults.length === 0) return;
    setIsAnalyzingAI(true);
    setAiError(null);

    try {
      const payload = {
        config: targetConfig,
        results: targetResults.map((r) => ({
          symbol: r.symbol,
          name: r.name,
          tickCount: r.tickCount,
          totalTrades: r.totalTrades,
          wins: r.wins,
          losses: r.losses,
          winRate: r.winRate,
          netPnL: r.netPnL,
          maxDrawdown: r.maxDrawdown,
          maxConsecutiveLosses: r.maxConsecutiveLosses,
          maxStakeUsed: r.maxStakeUsed,
          profitFactor: r.profitFactor,
          longestTriggerStreak: r.longestTriggerStreak,
          riskScore: r.riskScore,
          riskTier: r.riskTier,
        })),
      };

      const res = await fetch('/api/backtest/ai-analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || `AI analysis failed (${res.status})`);
      }

      setAiAnalysis(data.analysis);
    } catch (err: any) {
      setAiError(err?.message || 'AI analysis unavailable.');
    } finally {
      setIsAnalyzingAI(false);
    }
  };

  const handleRunBacktest = async (overrideStrategy?: StrategyType) => {
    const activeStrategy = overrideStrategy || config.strategy;
    const activeConfig: BacktestConfig = { ...config, strategy: activeStrategy };
    const fetchCount = activeStrategy === 'DCIRCLES_EVEN_ODD' ? 10000 : 5000;

    setIsFetching(true);
    setFetchErrorBanner(null);
    setAiError(null);
    setAiAnalysis(null);
    setAppliedBanner(null);
    setInspectedSymbol(null);

    try {
      const { series } = await fetchMarketsTickHistory(
        [...ALL_MARKET_SYMBOLS],
        fetchCount,
        (prog) => setFetchProgress(prog)
      );

      if (series.length === 0) {
        throw new Error('Could not retrieve historical ticks from Deriv. Please retry.');
      }

      setTickCache(series);
      const computed = runBacktestSuite(series, activeConfig);
      if (computed.length > 0) {
        void triggerAIAnalysis(computed, activeConfig);
      }
    } catch (err: any) {
      setFetchErrorBanner(err?.message || 'Backtest fetch failed');
    } finally {
      setIsFetching(false);
      setFetchProgress(null);
    }
  };

  const handleApplyMarketsToBot = (symbolsToApply: string[], label: string) => {
    const valid = symbolsToApply.filter((s) => ALL_MARKET_SYMBOLS.includes(s as any));
    if (valid.length === 0) return;

    const currentSubscribed = Array.isArray(settings.subscribedMarkets)
      ? settings.subscribedMarkets
      : [...ALL_MARKET_SYMBOLS];
    const mergedSubscribed = ALL_MARKET_SYMBOLS.filter(
      (s) => currentSubscribed.includes(s) || valid.includes(s)
    );

    const updatedSettings = {
      ...settings,
      strategy: config.strategy,
      evenOddMode: config.evenOddMode,
      targetStreak: config.targetStreak,
      globalStake: config.baseStake,
      selectedMarkets: valid,
      subscribedMarkets: mergedSubscribed,
    };

    setSettings(updatedSettings);
    setSelectedMarkets(valid);
    window.dispatchEvent(new CustomEvent('bot_settings_changed', { detail: updatedSettings }));
    setAppliedBanner(`Live bot updated with ${label}: ${valid.join(', ')}`);
    setTimeout(() => setAppliedBanner(null), 5000);
  };

  const riskBadgeClass = (tier: MarketBacktestResult['riskTier']) => {
    if (tier === 'LOW') return 'text-[#00ff9c] bg-[#00ff9c]/10 border-[#00ff9c]/30';
    if (tier === 'MODERATE') return 'text-[#38bdf8] bg-[#38bdf8]/10 border-[#38bdf8]/30';
    if (tier === 'ELEVATED') return 'text-[#ffb000] bg-[#ffb000]/10 border-[#ffb000]/30';
    return 'text-[#ff4b4b] bg-[#ff4b4b]/10 border-[#ff4b4b]/30';
  };

  const top3Symbols = rankedResults.slice(0, 3).map((r) => r.symbol);

  return (
    <div className="flex-1 overflow-y-auto p-3 sm:p-5">
      <div className="max-w-5xl mx-auto space-y-4">
        {/* Compact Parameter & Run Bar */}
        <div className="bg-[#111114] border border-[#27272a] rounded-lg p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-sm sm:text-base font-bold text-[#e4e4e7]">
                Best Markets Finder (Last 5,000 Ticks)
              </h1>
              <p className="text-xs text-[#a1a1aa] mt-0.5">
                Finds the safest Deriv indices with the lowest drawdown right now.
              </p>
            </div>

            <button
              type="button"
              onClick={() => handleRunBacktest()}
              disabled={isFetching}
              className="px-4 py-2 rounded bg-[#00ff9c] text-[#09090b] hover:opacity-90 disabled:opacity-50 font-mono text-xs font-bold flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
            >
              {isFetching ? (
                <>
                  <RefreshCw size={13} className="animate-spin" />
                  <span>
                    Scanning {fetchProgress?.completed ?? 0}/{fetchProgress?.total ?? 17}
                  </span>
                </>
              ) : (
                <>
                  <Play size={13} fill="currentColor" />
                  <span>
                    {tickCache.length > 0
                      ? config.strategy === 'DCIRCLES_EVEN_ODD'
                        ? 'Re-scan 10K (5K+5K)'
                        : 'Re-scan 5K Ticks'
                      : 'Find Best Markets'}
                  </span>
                </>
              )}
            </button>
          </div>

          <div className="flex flex-wrap items-end gap-3 pt-3 border-t border-[#27272a] font-mono text-xs">
            <div className="flex flex-col gap-1 min-w-[175px]">
              <label className="text-[10px] text-[#a1a1aa] uppercase">Strategy</label>
              <select
                value={config.strategy}
                onChange={(e) =>
                  setConfig((prev) => ({ ...prev, strategy: e.target.value as StrategyType }))
                }
                className="bg-[#18181b] border border-[#27272a] rounded px-2.5 py-1.5 text-[#e4e4e7] outline-none focus:border-[#00ff9c]"
              >
                <option value="EVEN_ODD">Even / Odd (Streak)</option>
                <option value="DCIRCLES_EVEN_ODD">D-Circles Even / Odd (5K)</option>
                <option value="DIGIT_OVER">Digit Over 1</option>
              </select>
            </div>

            {config.strategy === 'EVEN_ODD' && (
              <div className="flex flex-col gap-1 min-w-[140px]">
                <label className="text-[10px] text-[#a1a1aa] uppercase">Mode</label>
                <select
                  value={config.evenOddMode}
                  onChange={(e) =>
                    setConfig((prev) => ({ ...prev, evenOddMode: e.target.value as EvenOddMode }))
                  }
                  className="bg-[#18181b] border border-[#27272a] rounded px-2.5 py-1.5 text-[#38bdf8] outline-none focus:border-[#38bdf8]"
                >
                  <option value="reversal">Counter Streak</option>
                  <option value="follow">Follow Streak</option>
                </select>
              </div>
            )}

            {config.strategy !== 'DCIRCLES_EVEN_ODD' ? (
              <div className="flex flex-col gap-1 w-24">
                <label className="text-[10px] text-[#a1a1aa] uppercase">Streak</label>
                <input
                  type="number"
                  min={1}
                  max={10}
                  value={config.targetStreak}
                  onChange={(e) =>
                    setConfig((prev) => ({
                      ...prev,
                      targetStreak: Math.max(1, Math.min(10, Number(e.target.value) || 1)),
                    }))
                  }
                  className="bg-[#18181b] border border-[#27272a] rounded px-2.5 py-1.5 text-[#00ff9c] text-right tabular-nums outline-none focus:border-[#00ff9c]"
                />
              </div>
            ) : (
              <div className="flex flex-col gap-1">
                <span className="text-[10px] text-[#a1a1aa] uppercase">Entry Rule</span>
                <span className="px-2.5 py-1.5 rounded bg-[#18181b] border border-[#27272a] text-[#00ff9c] text-[11px] whitespace-nowrap">
                  5K Most &amp; Least Same Parity
                </span>
              </div>
            )}

            <div className="flex flex-col gap-1 w-28">
              <label className="text-[10px] text-[#a1a1aa] uppercase">Stake ($)</label>
              <input
                type="number"
                min={0.35}
                step={0.1}
                value={config.baseStake}
                onChange={(e) =>
                  setConfig((prev) => ({
                    ...prev,
                    baseStake: Math.max(0.35, Number(e.target.value) || 1),
                  }))
                }
                className="bg-[#18181b] border border-[#27272a] rounded px-2.5 py-1.5 text-[#00ff9c] text-right tabular-nums outline-none focus:border-[#00ff9c]"
              />
            </div>

            {tickCache.length > 0 && (
              <button
                type="button"
                onClick={() => triggerAIAnalysis(rankedResults, config)}
                disabled={isAnalyzingAI || isFetching}
                className="ml-auto px-3 py-1.5 rounded border border-[#38bdf8]/40 bg-[#38bdf8]/10 text-[#38bdf8] hover:bg-[#38bdf8]/20 disabled:opacity-50 font-semibold flex items-center gap-1.5 cursor-pointer"
              >
                <Sparkles size={12} />
                {isAnalyzingAI ? 'Asking AI...' : 'Refresh AI Pick'}
              </button>
            )}
          </div>

          {config.strategy === 'DCIRCLES_EVEN_ODD' &&
            tickCache.length > 0 &&
            tickCache[0].digits.length <= 5000 &&
            !isFetching && (
              <div className="flex flex-wrap items-center justify-between gap-2 bg-[#ffb000]/10 border border-[#ffb000]/30 text-[#ffb000] px-3 py-2 rounded text-xs font-mono">
                <span>
                  Cached data has 5,000 ticks (partial rolling warmup). Scan 10,000 ticks for full 5,000-tick lookback per trade.
                </span>
                <button
                  type="button"
                  onClick={() => handleRunBacktest('DCIRCLES_EVEN_ODD')}
                  className="px-2.5 py-1 rounded bg-[#ffb000]/20 hover:bg-[#ffb000]/30 font-bold cursor-pointer whitespace-nowrap"
                >
                  Load Full 10K Ticks
                </button>
              </div>
            )}

          {isFetching && fetchProgress && (
            <div className="space-y-1 pt-1 font-mono text-[11px]">
              <div className="flex justify-between text-[#a1a1aa]">
                <span>Checking {fetchProgress.currentSymbol}...</span>
                <span className="tabular-nums text-[#00ff9c]">
                  {fetchProgress.completed} / {fetchProgress.total}
                </span>
              </div>
              <div className="h-1.5 w-full bg-[#18181b] rounded overflow-hidden">
                <div
                  className="h-full bg-[#00ff9c] transition-all duration-150"
                  style={{
                    width: `${Math.round((fetchProgress.completed / Math.max(1, fetchProgress.total)) * 100)}%`,
                  }}
                />
              </div>
            </div>
          )}

          {fetchErrorBanner && (
            <div className="flex items-center gap-2 bg-[#ff4b4b]/10 border border-[#ff4b4b]/30 text-[#ff4b4b] px-3 py-2 rounded text-xs font-mono">
              <AlertTriangle size={14} className="shrink-0" />
              <span>{fetchErrorBanner}</span>
            </div>
          )}

          {appliedBanner && (
            <div className="flex items-center gap-2 bg-[#00ff9c]/10 border border-[#00ff9c]/30 text-[#00ff9c] px-3 py-2 rounded text-xs font-mono">
              <Check size={14} className="shrink-0" />
              <span>{appliedBanner}</span>
            </div>
          )}
        </div>

        {/* Empty State */}
        {tickCache.length === 0 && !isFetching && (
          <div className="bg-[#111114] border border-[#27272a] border-dashed rounded-lg py-14 px-6 flex flex-col items-center justify-center text-center space-y-3">
            <ShieldCheck size={28} className="text-[#00ff9c]" />
            <div className="max-w-md space-y-1">
              <h2 className="text-sm font-bold text-[#e4e4e7]">
                Scan for Low-Drawdown Markets
              </h2>
              <p className="text-xs text-[#a1a1aa]">
                Tests the last 5,000 ticks across all 17 markets and highlights only the safest ones to trade.
              </p>
            </div>
            <button
              type="button"
              onClick={() => handleRunBacktest()}
              className="px-5 py-2 rounded bg-[#00ff9c] text-[#09090b] font-mono text-xs font-bold flex items-center gap-2 hover:opacity-90 cursor-pointer"
            >
              <Play size={13} fill="currentColor" />
              Find Best Markets
            </button>
          </div>
        )}

        {/* Concise Results: AI Summary + Top 5 Best Markets */}
        {rankedResults.length > 0 && (
          <>
            {/* Compact AI Recommendation Strip */}
            <div className="bg-[#111114] border border-[#27272a] rounded-lg p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Bot size={15} className="text-[#38bdf8]" />
                  <span className="text-xs font-mono font-bold uppercase tracking-wider text-[#e4e4e7]">
                    AI Verdict
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  {aiAnalysis && aiAnalysis.recommendedMarkets.length > 0 ? (
                    <button
                      type="button"
                      onClick={() =>
                        handleApplyMarketsToBot(
                          aiAnalysis.recommendedMarkets.map((m) => m.symbol),
                          'AI Top Picks'
                        )
                      }
                      className="px-3 py-1.5 rounded bg-[#38bdf8] text-[#09090b] font-mono text-xs font-bold hover:opacity-90 cursor-pointer whitespace-nowrap"
                    >
                      Trade AI Picks ({aiAnalysis.recommendedMarkets.map((m) => m.symbol).join(', ')})
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => handleApplyMarketsToBot(top3Symbols, 'Top 3 Low-Drawdown Markets')}
                      className="px-3 py-1.5 rounded bg-[#00ff9c] text-[#09090b] font-mono text-xs font-bold hover:opacity-90 cursor-pointer whitespace-nowrap"
                    >
                      Trade Top 3 ({top3Symbols.join(', ')})
                    </button>
                  )}
                </div>
              </div>

              {isAnalyzingAI ? (
                <div className="flex items-center gap-2 text-xs font-mono text-[#a1a1aa]">
                  <RefreshCw size={13} className="animate-spin text-[#38bdf8]" />
                  <span>Selecting safest low-drawdown markets...</span>
                </div>
              ) : aiError ? (
                <div className="flex items-center justify-between gap-2 text-xs font-mono text-[#ffb000]">
                  <span>{aiError}</span>
                  <button
                    type="button"
                    onClick={() => triggerAIAnalysis(rankedResults, config)}
                    className="underline font-bold cursor-pointer shrink-0"
                  >
                    Retry
                  </button>
                </div>
              ) : aiAnalysis ? (
                <div className="space-y-2.5 text-xs">
                  <p className="text-[#e4e4e7] leading-relaxed">
                    {aiAnalysis.executiveSummary}{' '}
                    <span className="font-mono text-[#ffb000] tabular-nums">
                      Min safe balance: ${aiAnalysis.minSafeBankrollUsd.toFixed(2)}.
                    </span>
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {aiAnalysis.recommendedMarkets.map((pick) => (
                      <div
                        key={pick.symbol}
                        className="bg-black/30 border border-[#27272a] rounded px-2.5 py-1.5 font-mono text-[11px] flex items-center gap-2"
                      >
                        <span className="font-bold text-[#00ff9c]">{pick.symbol}</span>
                        <span className="text-[#a1a1aa]">{pick.rationale}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>

            {/* Best Markets Table (Top 5 by default) */}
            <div className="bg-[#111114] border border-[#27272a] rounded-lg overflow-hidden">
              <div className="px-4 py-3 border-b border-[#27272a] flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 font-mono text-xs">
                  <ShieldCheck size={14} className="text-[#00ff9c]" />
                  <span className="font-bold text-[#e4e4e7] uppercase tracking-wider">
                    {showAllMarkets ? `All ${rankedResults.length} Markets` : 'Top 5 Best Markets (Lowest Drawdown)'}
                  </span>
                </div>

                <button
                  type="button"
                  onClick={() => setShowAllMarkets((prev) => !prev)}
                  className="text-[11px] font-mono text-[#a1a1aa] hover:text-[#e4e4e7] flex items-center gap-1 cursor-pointer"
                >
                  {showAllMarkets ? (
                    <>
                      <span>Show Top 5 Only</span>
                      <ChevronUp size={13} />
                    </>
                  ) : (
                    <>
                      <span>Show All {rankedResults.length} Markets</span>
                      <ChevronDown size={13} />
                    </>
                  )}
                </button>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full min-w-[680px] text-left border-collapse font-mono text-xs">
                  <thead className="bg-[#09090b] text-[#a1a1aa] text-[10px] uppercase tracking-wider border-b border-[#27272a]">
                    <tr>
                      <th className="py-2.5 px-3 font-medium">Rank</th>
                      <th className="py-2.5 px-3 font-medium">Market</th>
                      <th className="py-2.5 px-3 font-medium">5K Trend</th>
                      <th className="py-2.5 px-3 font-medium text-right">Max Drawdown</th>
                      <th className="py-2.5 px-3 font-medium text-right">Net Profit</th>
                      <th className="py-2.5 px-3 font-medium text-right">Win Rate</th>
                      <th className="py-2.5 px-3 font-medium text-right">Worst Loss Streak</th>
                      <th className="py-2.5 px-3 font-medium text-right">Risk</th>
                      <th className="py-2.5 px-3 font-medium text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#27272a]/70">
                    {displayedResults.map((row, idx) => {
                      const isLiveEnabled = selectedLiveMarkets.includes(row.symbol);
                      const isInspected = inspectedSymbol === row.symbol;
                      return (
                        <tr
                          key={row.symbol}
                          onClick={() =>
                            setInspectedSymbol(isInspected ? null : row.symbol)
                          }
                          className={`cursor-pointer transition-colors ${
                            isInspected ? 'bg-[#00ff9c]/5' : 'hover:bg-white/[0.03]'
                          }`}
                        >
                          <td className="py-2.5 px-3 tabular-nums font-bold text-[#a1a1aa]">
                            #{idx + 1}
                          </td>
                          <td className="py-2.5 px-3">
                            <div className="font-bold text-[#e4e4e7]">{row.shortName}</div>
                            <div className="text-[10px] text-[#71717a]">{row.symbol}</div>
                          </td>
                          <td className="py-2.5 px-3">
                            <EquitySparkline curve={row.equityCurve} netPnL={row.netPnL} />
                          </td>
                          <td className="py-2.5 px-3 text-right tabular-nums font-bold text-[#ff4b4b]">
                            -${row.maxDrawdown.toFixed(2)}
                          </td>
                          <td
                            className={`py-2.5 px-3 text-right tabular-nums font-bold ${
                              row.netPnL >= 0 ? 'text-[#00ff9c]' : 'text-[#ff4b4b]'
                            }`}
                          >
                            {row.netPnL >= 0 ? '+' : ''}${row.netPnL.toFixed(2)}
                          </td>
                          <td className="py-2.5 px-3 text-right tabular-nums text-[#e4e4e7]">
                            {row.winRate.toFixed(0)}%
                          </td>
                          <td className="py-2.5 px-3 text-right tabular-nums text-[#a1a1aa]">
                            {row.maxConsecutiveLosses} in a row
                          </td>
                          <td className="py-2.5 px-3 text-right">
                            <span
                              className={`inline-block px-2 py-0.5 rounded border text-[10px] font-bold ${riskBadgeClass(row.riskTier)}`}
                            >
                              {row.riskTier}
                            </span>
                          </td>
                          <td
                            className="py-2.5 px-3 text-right"
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleMarketSelection(row.symbol);
                            }}
                          >
                            <button
                              type="button"
                              className={`px-2.5 py-1 rounded border text-[10px] font-bold cursor-pointer ${
                                isLiveEnabled
                                  ? 'bg-[#00ff9c]/15 border-[#00ff9c]/40 text-[#00ff9c]'
                                  : 'bg-white/5 border-[#27272a] text-[#a1a1aa] hover:text-[#e4e4e7]'
                              }`}
                            >
                              {isLiveEnabled ? 'TRADING' : 'ENABLE'}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Optional Compact Chart Drawer (only opens when user clicks a market row) */}
            {inspectedResult && (
              <div className="bg-[#111114] border border-[#27272a] rounded-lg p-4 space-y-3">
                <div className="flex items-center justify-between gap-2 font-mono text-xs">
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="font-bold text-[#e4e4e7]">
                      {inspectedResult.name} ({inspectedResult.symbol})
                    </span>
                    <span className="text-[#a1a1aa] tabular-nums">
                      {inspectedResult.totalTrades} trades ({inspectedResult.wins}W / {inspectedResult.losses}L) · Peak Stake: ${inspectedResult.maxStakeUsed.toFixed(2)}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setInspectedSymbol(null)}
                    className="text-[#71717a] hover:text-[#e4e4e7] p-1 cursor-pointer"
                    title="Close chart"
                  >
                    <X size={15} />
                  </button>
                </div>
                <MarketChart result={inspectedResult} />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
