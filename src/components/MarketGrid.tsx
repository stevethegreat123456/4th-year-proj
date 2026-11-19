import React, { useState } from 'react';
import { useStore, MarketData, ALL_MARKET_SYMBOLS, EvenOddMode } from '../store/useStore';
import { Target, Check, Filter, AlertTriangle, Radio, Binary } from 'lucide-react';
import { MarketMultiSelect } from './MarketMultiSelect';

export function MarketGrid() {
  const markets = useStore((state) => state.markets);
  const settings = useStore((state) => state.settings);
  const toggleMarketSelection = useStore((state) => state.toggleMarketSelection);
  const setSelectedMarkets = useStore((state) => state.setSelectedMarkets);
  const setSubscribedMarkets = useStore((state) => state.setSubscribedMarkets);
  const lastLostSymbol = useStore((state) => state.lastLostSymbol);
  const isWaitingForRecovery = useStore((state) => state.isWaitingForRecovery);
  const [showSelectedOnly, setShowSelectedOnly] = useState(false);

  const isEvenOdd = settings.strategy === 'EVEN_ODD';
  const evenOddMode: EvenOddMode = settings.evenOddMode || 'reversal';
  const connectionStatus = useStore((state) => state.connectionStatus);

  const subscribedMarkets: string[] = Array.isArray(settings.subscribedMarkets)
    ? settings.subscribedMarkets
    : [...ALL_MARKET_SYMBOLS];

  const selectedMarkets: string[] = Array.isArray(settings.selectedMarkets)
    ? settings.selectedMarkets
    : [...ALL_MARKET_SYMBOLS];

  const marketList = Object.values(markets);
  const subscribedMarketList = marketList.filter((m) => subscribedMarkets.includes(m.symbol));
  const displayedMarkets = showSelectedOnly
    ? subscribedMarketList.filter((m) => selectedMarkets.includes(m.symbol))
    : subscribedMarketList;
  const activeTradingCount = subscribedMarketList.filter((m) => selectedMarkets.includes(m.symbol)).length;
  const hasAnyData = subscribedMarketList.some((m) => m.currentPrice > 0);
  const allSelected = selectedMarkets.length === ALL_MARKET_SYMBOLS.length;

  return (
    <div className="space-y-3">
      {/* Unified Compact Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2 bg-[#111114] border border-[#27272a] px-3 sm:px-4 py-2 rounded-lg text-[11px] font-mono">
        <div className="flex flex-wrap items-center gap-2">
          {isEvenOdd ? (
            <span className="bg-[#38bdf8]/10 text-[#38bdf8] border border-[#38bdf8]/30 px-2 py-0.5 rounded font-bold flex items-center gap-1.5 whitespace-nowrap">
              <Binary size={12} />
              EVEN/ODD · {settings.targetStreak || 3} · {evenOddMode === 'follow' ? 'FOLLOW' : 'COUNTER'}
            </span>
          ) : (
            <span className="bg-[#ffb000]/10 text-[#ffb000] border border-[#ffb000]/30 px-2 py-0.5 rounded font-bold whitespace-nowrap">
              OVER 1 · STREAK {settings.targetStreak || 3}
            </span>
          )}
          <MarketMultiSelect />
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <span
            className={`px-2 py-0.5 rounded font-bold border tabular-nums mr-1 ${
              activeTradingCount > 0
                ? 'bg-[#00ff9c]/10 text-[#00ff9c] border-[#00ff9c]/30'
                : 'bg-[#ffb000]/10 text-[#ffb000] border-[#ffb000]/30'
            }`}
          >
            {activeTradingCount}/{subscribedMarketList.length} Trading
          </span>
          <button
            type="button"
            onClick={() => setSelectedMarkets([...ALL_MARKET_SYMBOLS])}
            disabled={allSelected}
            className={`px-2 py-1 rounded border text-[10px] uppercase font-semibold transition-colors ${
              allSelected
                ? 'border-[#27272a] text-[#52525b] cursor-default'
                : 'border-[#27272a] bg-white/5 text-[#e4e4e7] hover:border-[#00ff9c]/50 hover:text-[#00ff9c] cursor-pointer'
            }`}
          >
            All
          </button>
          <button
            type="button"
            onClick={() => setSelectedMarkets([])}
            disabled={selectedMarkets.length === 0}
            className={`px-2 py-1 rounded border text-[10px] uppercase font-semibold transition-colors ${
              selectedMarkets.length === 0
                ? 'border-[#27272a] text-[#52525b] cursor-default'
                : 'border-[#27272a] bg-white/5 text-[#a1a1aa] hover:border-[#ff4b4b]/50 hover:text-[#ff4b4b] cursor-pointer'
            }`}
          >
            Clear
          </button>
          <button
            type="button"
            onClick={() => setShowSelectedOnly((prev) => !prev)}
            className={`px-2 py-1 rounded border text-[10px] uppercase font-semibold flex items-center gap-1 transition-colors cursor-pointer ${
              showSelectedOnly
                ? 'bg-[#00ff9c]/15 border-[#00ff9c]/50 text-[#00ff9c]'
                : 'border-[#27272a] bg-white/5 text-[#a1a1aa] hover:text-[#e4e4e7]'
            }`}
            title="Show only markets enabled for trading"
          >
            <Filter size={10} />
            Active Only
          </button>
        </div>
      </div>

      {subscribedMarketList.length > 0 && activeTradingCount === 0 && (
        <div className="flex items-center justify-between gap-2 bg-[#ffb000]/10 border border-[#ffb000]/30 text-[#ffb000] px-4 py-2 rounded-lg text-[11px] font-mono">
          <div className="flex items-center gap-2">
            <AlertTriangle size={14} className="shrink-0" />
            <span>Watch-only mode: no markets selected for auto-trading.</span>
          </div>
          <button
            type="button"
            onClick={() => setSelectedMarkets([...ALL_MARKET_SYMBOLS])}
            className="px-2 py-0.5 bg-[#ffb000]/20 hover:bg-[#ffb000]/30 rounded font-bold uppercase text-[10px] shrink-0 cursor-pointer"
          >
            Enable All
          </button>
        </div>
      )}

      {subscribedMarketList.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 bg-[#111114] border border-[#27272a] border-dashed rounded-xl space-y-3 font-mono">
          <Radio size={24} className="text-[#71717a]" />
          <div className="text-center space-y-1">
            <div className="text-sm font-bold text-[#e4e4e7] uppercase tracking-wider">
              No Tick Streams Subscribed
            </div>
            <p className="text-[11px] text-[#71717a]">
              Select indices from the <strong className="text-[#00ff9c]">Tick Stream</strong> dropdown above.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setSubscribedMarkets([...ALL_MARKET_SYMBOLS])}
            className="px-3 py-1.5 rounded bg-[#00ff9c]/15 border border-[#00ff9c]/40 text-[#00ff9c] text-[11px] font-bold uppercase hover:bg-[#00ff9c]/25 transition-colors cursor-pointer"
          >
            Subscribe All 17 Indices
          </button>
        </div>
      ) : !hasAnyData && connectionStatus === 'connected' ? (
        <div className="flex flex-col items-center justify-center py-20 bg-[#111114] border border-[#27272a] border-dashed rounded-xl space-y-4">
          <div className="relative">
            <div className="w-12 h-12 border-2 border-[#00ff9c]/20 border-t-[#00ff9c] rounded-full animate-spin" />
            <div className="absolute inset-0 flex items-center justify-center">
              <Target size={18} className="text-[#00ff9c]" />
            </div>
          </div>
          <div className="text-center space-y-1">
            <div className="text-sm font-bold text-[#e4e4e7] uppercase tracking-widest">Connecting Feed</div>
            <p className="text-[11px] text-[#71717a] font-mono">
              Subscribing to {subscribedMarketList.length} {subscribedMarketList.length === 1 ? 'Index' : 'Indices'}...
            </p>
          </div>
        </div>
      ) : null}

      {subscribedMarketList.length > 0 && showSelectedOnly && displayedMarkets.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 bg-[#111114] border border-[#27272a] border-dashed rounded-xl space-y-2 font-mono">
          <p className="text-xs text-[#a1a1aa]">No subscribed markets are enabled for trading.</p>
          <button
            type="button"
            onClick={() => setShowSelectedOnly(false)}
            className="text-[11px] text-[#00ff9c] hover:underline uppercase font-bold cursor-pointer"
          >
            Show all {subscribedMarketList.length} subscribed markets
          </button>
        </div>
      ) : subscribedMarketList.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5 content-start">
          {displayedMarkets.map((market) => (
            <MarketCard
              key={market.symbol}
              market={market}
              isEvenOdd={isEvenOdd}
              evenOddMode={evenOddMode}
              targetStreak={settings.targetStreak || 3}
              lastLostSymbol={lastLostSymbol}
              isWaitingForRecovery={isWaitingForRecovery}
              isSelected={selectedMarkets.includes(market.symbol)}
              onToggleSelect={() => toggleMarketSelection(market.symbol)}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}


interface MarketCardProps {
  market: MarketData;
  isEvenOdd: boolean;
  evenOddMode: EvenOddMode;
  targetStreak: number;
  lastLostSymbol: string | null;
  isWaitingForRecovery: boolean;
  isSelected: boolean;
  onToggleSelect: () => void;
}

const MarketCard: React.FC<MarketCardProps> = ({ 
  market, 
  isEvenOdd,
  evenOddMode,
  targetStreak, 
  lastLostSymbol, 
  isWaitingForRecovery,
  isSelected,
  onToggleSelect
}) => {
  const history = market.streakHistory.slice(-20);
  while (history.length < 20) history.unshift(-1);

  const evenStreak = market.evenStreak || 0;
  const oddStreak = market.oddStreak || 0;
  const activeParity: 'even' | 'odd' | null = evenStreak > 0 ? 'even' : oddStreak > 0 ? 'odd' : null;
  const activeParityStreak = activeParity === 'even' ? evenStreak : activeParity === 'odd' ? oddStreak : 0;

  const currentStreakValue = isEvenOdd ? activeParityStreak : market.streak;
  const isCloseToTarget = currentStreakValue >= targetStreak - 1 && currentStreakValue < targetStreak;
  const isTargetMet = currentStreakValue >= targetStreak;
  const inRecoveryThisSymbol = isWaitingForRecovery && lastLostSymbol === market.symbol;

  const targetContractLabel = activeParity === 'even'
    ? (evenOddMode === 'follow' ? 'EVEN' : 'ODD')
    : (evenOddMode === 'follow' ? 'ODD' : 'EVEN');

  return (
    <div className={`bg-[#111114] border rounded-lg p-3.5 flex flex-col gap-2.5 transition-all ${
      inRecoveryThisSymbol 
        ? 'border-[#ff4b4b] ring-1 ring-[#ff4b4b]' 
        : isTargetMet && isSelected
          ? (isEvenOdd ? 'border-[#38bdf8]' : 'border-[#ff4b4b]')
          : isCloseToTarget && isSelected
            ? 'border-[#ffb000]/50' 
            : 'border-[#27272a]'
    } ${!isSelected ? 'opacity-65 hover:opacity-90' : ''}`}>
      
      {/* Header */}
      <div className="flex justify-between items-start gap-2">
        <div className="font-semibold text-[13px] flex items-center gap-1.5 flex-wrap">
          <span>{market.name}</span>
          {inRecoveryThisSymbol && (
            <span className="text-[9px] bg-[#ff4b4b]/20 text-[#ff4b4b] px-1.5 py-0.5 rounded font-mono uppercase font-bold">
              Recovery
            </span>
          )}
        </div>
        
        <button
          type="button"
          onClick={onToggleSelect}
          title={isSelected ? 'Trading enabled (click to switch to Watch Only)' : 'Watch Only (click to enable trading)'}
          className={`shrink-0 text-[10px] px-2 py-0.5 rounded border font-mono font-bold flex items-center gap-1 transition-colors cursor-pointer ${
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
            <>WATCH</>
          )}
        </button>
      </div>
      
      {/* Live Price */}
      <div className="font-mono text-[19px] font-bold tabular-nums">
        {market.currentPrice === 0 ? '---.----' : market.currentPrice.toFixed(4)}
      </div>

      {/* Even / Odd Streak Indicator */}
      {isEvenOdd ? (
        <>
          <div className="grid grid-cols-10 gap-1">
            {history.map((digit, i) => {
              if (digit === -1) {
                return (
                  <div key={i} className="h-5 sm:h-6 flex items-center justify-center font-mono text-[10px] sm:text-[11px] rounded bg-white/5 border border-[#27272a]" />
                );
              }
              const isDigitEven = digit % 2 === 0;
              return (
                <div 
                  key={i} 
                  title={`${digit} (${isDigitEven ? 'Even' : 'Odd'})`}
                  className={`h-5 sm:h-6 flex items-center justify-center font-mono text-[10px] sm:text-[11px] rounded border tabular-nums ${
                    isDigitEven
                      ? 'bg-[#38bdf8]/15 text-[#38bdf8] border-[#38bdf8]/40'
                      : 'bg-[#ffb000]/15 text-[#ffb000] border-[#ffb000]/40'
                  }`}
                >
                  {digit}
                </div>
              );
            })}
          </div>

          <div className="flex items-center gap-1.5 mt-0.5">
            {Array.from({ length: targetStreak }).map((_, i) => {
              const filled = i < activeParityStreak;
              const dotClass = !filled
                ? 'bg-transparent border-[#27272a]'
                : activeParity === 'even'
                  ? 'bg-[#38bdf8] border-[#38bdf8]'
                  : 'bg-[#ffb000] border-[#ffb000]';
              return <div key={i} className={`w-2.5 h-2.5 rounded-full border ${dotClass}`} />;
            })}
            <span className={`text-[10px] font-mono font-semibold uppercase tracking-wider ml-1 tabular-nums ${
              activeParityStreak >= targetStreak
                ? (activeParity === 'even' ? 'text-[#38bdf8]' : 'text-[#ffb000]')
                : 'text-[#a1a1aa]'
            }`}>
              {activeParityStreak >= targetStreak
                ? `EXEC ${targetContractLabel}`
                : activeParity
                  ? `${activeParity.toUpperCase()} ${activeParityStreak}/${targetStreak}`
                  : `0/${targetStreak}`}
            </span>
          </div>
        </>
      ) : (
        /* Digit Over 1 Indicator */
        <>
          <div className="grid grid-cols-10 gap-1">
            {history.map((digit, i) => {
              const isHighlight = digit === 0 || digit === 1;
              if (digit === -1) {
                return (
                  <div key={i} className="h-5 sm:h-6 flex items-center justify-center font-mono text-[10px] sm:text-[11px] rounded bg-white/5 border border-[#27272a]" />
                );
              }
              return (
                <div 
                  key={i} 
                  className={`h-5 sm:h-6 flex items-center justify-center font-mono text-[10px] sm:text-[11px] rounded border tabular-nums ${
                    isHighlight ? 'bg-[#ff4b4b]/20 text-[#ff4b4b] border-[#ff4b4b]' : 'bg-white/5 border-[#27272a]'
                  }`}
                >
                  {digit}
                </div>
              );
            })}
          </div>
          
          <div className="flex items-center gap-1.5 mt-0.5">
            {Array.from({ length: targetStreak }).map((_, i) => (
              <div 
                key={i} 
                className={`w-2.5 h-2.5 rounded-full border ${
                  i < market.streak ? 'bg-[#ff4b4b] border-[#ff4b4b]' : 'bg-transparent border-[#27272a]'
                }`}
              />
            ))}
            <span className={`text-[10px] font-mono font-semibold uppercase tracking-wider ml-1 tabular-nums ${
              market.streak >= targetStreak ? 'text-[#ff4b4b]' : 'text-[#a1a1aa]'
            }`}>
              {market.streak >= targetStreak ? 'EXEC OVER 1' : `${market.streak}/${targetStreak}`}
            </span>
          </div>
        </>
      )}
    </div>
  );
};
