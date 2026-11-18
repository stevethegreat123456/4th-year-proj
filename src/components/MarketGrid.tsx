import React, { useState } from 'react';
import { useStore, MarketData, ALL_MARKET_SYMBOLS } from '../store/useStore';
import { TrendingUp, TrendingDown, Clock, Target, Check, Filter, AlertTriangle } from 'lucide-react';

export function MarketGrid() {
  const markets = useStore((state) => state.markets);
  const settings = useStore((state) => state.settings);
  const toggleMarketSelection = useStore((state) => state.toggleMarketSelection);
  const setSelectedMarkets = useStore((state) => state.setSelectedMarkets);
  const lastLostSymbol = useStore((state) => state.lastLostSymbol);
  const isWaitingForRecovery = useStore((state) => state.isWaitingForRecovery);
  const [showSelectedOnly, setShowSelectedOnly] = useState(false);

  const isRiseFall = settings.strategy === 'RISE_FALL';
  const connectionStatus = useStore((state) => state.connectionStatus);

  const selectedMarkets: string[] = Array.isArray(settings.selectedMarkets)
    ? settings.selectedMarkets
    : settings.selectedMarket && settings.selectedMarket !== 'ALL' && settings.selectedMarket !== 'CUSTOM'
      ? [settings.selectedMarket]
      : [...ALL_MARKET_SYMBOLS];

  const marketList = Object.values(markets);
  const displayedMarkets = showSelectedOnly
    ? marketList.filter((m) => selectedMarkets.includes(m.symbol))
    : marketList;
  const hasAnyData = marketList.some((m) => m.currentPrice > 0);
  const allSelected = selectedMarkets.length === ALL_MARKET_SYMBOLS.length;

  return (
    <div className="space-y-3">
      {/* Strategy Indicator Banner */}
      <div className="flex flex-wrap items-center justify-between gap-2 bg-[#111114] border border-[#27272a] px-4 py-2.5 rounded-lg text-xs font-mono">
        <div className="flex items-center gap-2">
          <span className="text-[#a1a1aa] uppercase tracking-wider">Active Mode:</span>
          {isRiseFall ? (
            <span className="bg-[#00ff9c]/10 text-[#00ff9c] border border-[#00ff9c]/30 px-2 py-0.5 rounded font-bold flex items-center gap-1.5">
              <TrendingUp size={13} />
              RISE & FALL (MOMENTUM) — {settings.timeframe ? (settings.timeframe >= 60 ? `${settings.timeframe / 60}M` : `${settings.timeframe}S`) : '1M'}
            </span>
          ) : (
            <span className="bg-[#ffb000]/10 text-[#ffb000] border border-[#ffb000]/30 px-2 py-0.5 rounded font-bold">
              DIGIT OVER 1 (TARGET STREAK: {settings.targetStreak || 3})
            </span>
          )}
        </div>

        <div className="flex items-center gap-3 text-[#a1a1aa] text-[11px]">
          {isRiseFall && (
            <span className="hidden sm:inline">
              Trade Duration: <strong className="text-[#e4e4e7]">{settings.tradeDuration || 1}{settings.tradeDurationUnit || 'm'}</strong>
            </span>
          )}
          <span className="flex items-center gap-1.5">
            <div className={`w-1.5 h-1.5 rounded-full ${connectionStatus === 'connected' ? 'bg-[#00ff9c] animate-pulse' : 'bg-[#ff4b4b]'}`} />
            <span className={connectionStatus === 'connected' ? 'text-[#00ff9c]' : 'text-[#ff4b4b]'}>
              {connectionStatus === 'connected' ? 'LIVE FEED' : 'OFFLINE'}
            </span>
          </span>
        </div>
      </div>

      {/* Tradable Markets Selection Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 bg-[#111114] border border-[#27272a] px-3 sm:px-4 py-2 rounded-lg text-[11px] font-mono">
        <div className="flex items-center gap-2">
          <span className="text-[#a1a1aa] uppercase tracking-wider">Trading Markets:</span>
          <span className={`px-2 py-0.5 rounded font-bold border ${
            selectedMarkets.length > 0
              ? 'bg-[#00ff9c]/10 text-[#00ff9c] border-[#00ff9c]/30'
              : 'bg-[#ffb000]/10 text-[#ffb000] border-[#ffb000]/30'
          }`}>
            {selectedMarkets.length} / {ALL_MARKET_SYMBOLS.length} Active
          </span>
          <span className="hidden md:inline text-[#71717a] text-[10px]">
            Click any card&apos;s badge to toggle trading on that market
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setSelectedMarkets([...ALL_MARKET_SYMBOLS])}
            disabled={allSelected}
            className={`px-2 py-1 rounded border text-[10px] uppercase font-semibold transition-colors ${
              allSelected
                ? 'border-[#27272a] text-[#52525b] cursor-default'
                : 'border-[#27272a] bg-white/5 text-[#e4e4e7] hover:border-[#00ff9c]/50 hover:text-[#00ff9c]'
            }`}
          >
            Select All
          </button>
          <button
            type="button"
            onClick={() => setSelectedMarkets([])}
            disabled={selectedMarkets.length === 0}
            className={`px-2 py-1 rounded border text-[10px] uppercase font-semibold transition-colors ${
              selectedMarkets.length === 0
                ? 'border-[#27272a] text-[#52525b] cursor-default'
                : 'border-[#27272a] bg-white/5 text-[#a1a1aa] hover:border-[#ff4b4b]/50 hover:text-[#ff4b4b]'
            }`}
          >
            Clear
          </button>
          <button
            type="button"
            onClick={() => setShowSelectedOnly((prev) => !prev)}
            className={`px-2 py-1 rounded border text-[10px] uppercase font-semibold flex items-center gap-1 transition-colors ${
              showSelectedOnly
                ? 'bg-[#00ff9c]/15 border-[#00ff9c]/50 text-[#00ff9c]'
                : 'border-[#27272a] bg-white/5 text-[#a1a1aa] hover:text-[#e4e4e7]'
            }`}
            title="Show only markets enabled for trading"
          >
            <Filter size={10} />
            Selected Only
          </button>
        </div>
      </div>

      {selectedMarkets.length === 0 && (
        <div className="flex items-center justify-between gap-2 bg-[#ffb000]/10 border border-[#ffb000]/30 text-[#ffb000] px-4 py-2 rounded-lg text-[11px] font-mono">
          <div className="flex items-center gap-2">
            <AlertTriangle size={14} className="shrink-0" />
            <span>0 markets selected for auto-trading. Live feeds remain active in Watch Only mode.</span>
          </div>
          <button
            type="button"
            onClick={() => setSelectedMarkets([...ALL_MARKET_SYMBOLS])}
            className="px-2 py-0.5 bg-[#ffb000]/20 hover:bg-[#ffb000]/30 rounded font-bold uppercase text-[10px] shrink-0"
          >
            Enable All
          </button>
        </div>
      )}

      {!hasAnyData && connectionStatus === 'connected' && (
        <div className="flex flex-col items-center justify-center py-20 bg-[#111114] border border-[#27272a] border-dashed rounded-xl space-y-4">
          <div className="relative">
            <div className="w-12 h-12 border-2 border-[#00ff9c]/20 border-t-[#00ff9c] rounded-full animate-spin" />
            <div className="absolute inset-0 flex items-center justify-center">
              <Target size={18} className="text-[#00ff9c]" />
            </div>
          </div>
          <div className="text-center space-y-1">
            <div className="text-sm font-bold text-[#e4e4e7] uppercase tracking-widest">Establishing Stream</div>
            <p className="text-[11px] text-[#71717a] font-mono">Subscribing to 17 Volatility Indices...</p>
          </div>
        </div>
      )}

      {showSelectedOnly && displayedMarkets.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 bg-[#111114] border border-[#27272a] border-dashed rounded-xl space-y-2 font-mono">
          <p className="text-xs text-[#a1a1aa]">No markets are currently selected for trading.</p>
          <button
            type="button"
            onClick={() => setShowSelectedOnly(false)}
            className="text-[11px] text-[#00ff9c] hover:underline uppercase font-bold"
          >
            Show all 17 markets
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 content-start">
          {displayedMarkets.map((market) => (
            <MarketCard
              key={market.symbol}
              market={market}
              isRiseFall={isRiseFall}
              targetStreak={settings.targetStreak || 3}
              lastLostSymbol={lastLostSymbol}
              isWaitingForRecovery={isWaitingForRecovery}
              timeframe={settings.timeframe || 60}
              isSelected={selectedMarkets.includes(market.symbol)}
              onToggleSelect={() => toggleMarketSelection(market.symbol)}
            />
          ))}
        </div>
      )}
    </div>
  );
}


interface MarketCardProps {
  market: MarketData;
  isRiseFall: boolean;
  targetStreak: number;
  lastLostSymbol: string | null;
  isWaitingForRecovery: boolean;
  timeframe: number;
  isSelected: boolean;
  onToggleSelect: () => void;
}

const MarketCard: React.FC<MarketCardProps> = ({ 
  market, 
  isRiseFall, 
  targetStreak, 
  lastLostSymbol, 
  isWaitingForRecovery,
  isSelected,
  onToggleSelect
}) => {
  // Digit history
  const history = market.streakHistory.slice(-10);
  while (history.length < 10) history.unshift(-1);
  
  const isCloseToTarget = !isRiseFall && market.streak >= targetStreak - 1 && market.streak < targetStreak;
  const isTargetMet = !isRiseFall && market.streak >= targetStreak;
  const inRecoveryThisSymbol = isWaitingForRecovery && lastLostSymbol === market.symbol;

  const prevTrend = market.prevCandleTrend;
  const isBullish = prevTrend === 'bullish';
  const isBearish = prevTrend === 'bearish';

  return (
    <div className={`bg-[#111114] border rounded-lg p-4 flex flex-col gap-3 transition-all ${
      inRecoveryThisSymbol 
        ? 'border-[#ff4b4b] shadow-[0_0_15px_rgba(255,75,75,0.25)] ring-1 ring-[#ff4b4b]' 
        : isTargetMet && isSelected
          ? 'border-[#ff4b4b] shadow-[0_0_15px_rgba(255,75,75,0.2)]' 
          : isCloseToTarget && isSelected
            ? 'border-[#ffb000]/50 shadow-[0_0_15px_rgba(255,176,0,0.1)]' 
            : isRiseFall && isBullish && isSelected
              ? 'border-[#00ff9c]/40 hover:border-[#00ff9c]/70'
              : isRiseFall && isBearish && isSelected
                ? 'border-[#ff4b4b]/40 hover:border-[#ff4b4b]/70'
                : 'border-[#27272a]'
    } ${!isSelected ? 'opacity-65 hover:opacity-90' : ''}`}>
      
      {/* Header */}
      <div className="flex justify-between items-start gap-2">
        <div className="font-semibold text-[14px] flex items-center gap-1.5 flex-wrap">
          <span>{market.name}</span>
          {inRecoveryThisSymbol && (
            <span className="text-[9px] bg-[#ff4b4b]/20 text-[#ff4b4b] px-1.5 py-0.5 rounded font-mono uppercase font-bold">
              Recovery Target
            </span>
          )}
        </div>
        
        <button
          type="button"
          onClick={onToggleSelect}
          title={isSelected ? 'Enabled for auto-trading (click to set Watch Only)' : 'Watch Only — live feed active, no trades placed (click to enable trading)'}
          className={`shrink-0 text-[10px] px-2 py-0.5 rounded border font-mono font-bold flex items-center gap-1.5 transition-colors cursor-pointer ${
            isSelected
              ? 'bg-[#00ff9c]/10 border-[#00ff9c]/40 text-[#00ff9c] hover:bg-[#00ff9c]/20'
              : 'bg-white/5 border-[#27272a] text-[#71717a] hover:text-[#e4e4e7] hover:border-[#3f3f46]'
          }`}
        >
          {isSelected ? (
            <>
              <Check size={10} strokeWidth={3} />
              TRADING
            </>
          ) : (
            <>WATCH ONLY</>
          )}
        </button>
      </div>
      
      {/* Live Price */}
      <div className="flex items-baseline justify-between">
        <div className="font-mono text-[20px] font-bold">
          {market.currentPrice === 0 ? '---.----' : market.currentPrice.toFixed(4)}
        </div>

        {isRiseFall && market.candleTimeRemaining !== undefined && (
          <div className="flex items-center gap-1 text-[10px] text-[#a1a1aa] font-mono bg-white/5 px-2 py-0.5 rounded border border-[#27272a]">
            <Clock size={11} className="text-[#00ff9c]" />
            <span>{market.candleTimeRemaining}s to close</span>
          </div>
        )}
      </div>

      {/* Rise & Fall Candle Signal Indicator */}
      {isRiseFall ? (
        <div className="space-y-2 pt-1 border-t border-[#27272a]/60">
          <div className="flex items-center justify-between text-[11px] font-mono">
            <span className="text-[#a1a1aa] text-[10px] uppercase tracking-wider">Prev Candle:</span>
            {isBullish ? (
              <span className="flex items-center gap-1 font-bold text-[#00ff9c] bg-[#00ff9c]/10 border border-[#00ff9c]/30 px-2 py-0.5 rounded text-[10px]">
                <TrendingUp size={12} />
                BULLISH → NEXT TRADE: RISE
              </span>
            ) : isBearish ? (
              <span className="flex items-center gap-1 font-bold text-[#ff4b4b] bg-[#ff4b4b]/10 border border-[#ff4b4b]/30 px-2 py-0.5 rounded text-[10px]">
                <TrendingDown size={12} />
                BEARISH → NEXT TRADE: FALL
              </span>
            ) : (
              <span className="text-[#71717a] bg-white/5 px-2 py-0.5 rounded text-[10px]">
                AWAITING CANDLE CLOSE...
              </span>
            )}
          </div>

          {(market.prevCandleOpen !== undefined && market.prevCandleClose !== undefined) && (
            <div className="grid grid-cols-2 gap-2 text-[10px] font-mono text-[#a1a1aa] bg-black/30 p-1.5 rounded border border-[#27272a]/40">
              <div>
                Open: <span className="text-[#e4e4e7]">{market.prevCandleOpen.toFixed(4)}</span>
              </div>
              <div className="text-right">
                Close: <span className={isBullish ? 'text-[#00ff9c]' : isBearish ? 'text-[#ff4b4b]' : 'text-[#e4e4e7]'}>
                  {market.prevCandleClose.toFixed(4)}
                </span>
              </div>
            </div>
          )}

          {/* Current forming candle preview */}
          {market.candleOpen !== undefined && (
            <div className="text-[10px] font-mono flex items-center justify-between text-[#71717a] px-1">
              <span>Forming: O:{market.candleOpen.toFixed(2)}</span>
              <span>C:{market.candleClose ? market.candleClose.toFixed(2) : market.currentPrice.toFixed(2)}</span>
            </div>
          )}
        </div>
      ) : (
        /* Digit Over 1 Indicator */
        <>
          <div className="flex gap-1 mt-1 flex-wrap">
            {history.map((digit, i) => {
              const isHighlight = digit === 0 || digit === 1;
              if (digit === -1) {
                return (
                  <div key={i} className="w-5 h-5 sm:w-6 sm:h-6 flex items-center justify-center font-mono text-[10px] sm:text-[12px] rounded bg-white/5 border border-[#27272a]" />
                );
              }
              return (
                <div 
                  key={i} 
                  className={`w-5 h-5 sm:w-6 sm:h-6 flex items-center justify-center font-mono text-[10px] sm:text-[12px] rounded border ${
                    isHighlight ? 'bg-[#ff4b4b]/20 text-[#ff4b4b] border-[#ff4b4b]' : 'bg-white/5 border-[#27272a]'
                  }`}
                >
                  {digit}
                </div>
              );
            })}
          </div>
          
          <div className="flex flex-col mt-2">
            <div className="flex items-center gap-1.5 mt-1">
              {Array.from({ length: targetStreak }).map((_, i) => (
                <div 
                  key={i} 
                  className={`w-2.5 h-2.5 rounded-full border ${
                    i < market.streak ? 'bg-[#ff4b4b] border-[#ff4b4b] shadow-[0_0_8px_#ff4b4b]' : 'bg-transparent border-[#27272a]'
                  }`}
                />
              ))}
              <span className={`text-[10px] font-semibold uppercase tracking-wider ml-1 ${
                market.streak >= targetStreak ? 'text-[#ff4b4b]' : 'text-[#a1a1aa]'
              }`}>
                {market.streak >= targetStreak ? 'EXECUTING OVER 1...' : `STREAK: ${market.streak}/${targetStreak}`}
              </span>
            </div>
          </div>
        </>
      )}
    </div>
  );
};
