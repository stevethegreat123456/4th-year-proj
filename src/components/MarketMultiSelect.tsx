import React, { useState, useRef, useEffect, useMemo } from 'react';
import { ChevronDown, Check, Search, Radio, X } from 'lucide-react';
import { useStore, SYNTHETIC_MARKET_CATALOG, ALL_MARKET_SYMBOLS } from '../store/useStore';

type MarketGroup = 'volatility' | '1s' | 'jump' | 'daily';

const GROUP_LABELS: Record<MarketGroup, string> = {
  volatility: 'Volatility Indices',
  '1s': 'Volatility (1s) Indices',
  jump: 'Jump Indices',
  daily: 'Daily Reset Indices'
};

const GROUP_SHORT: Record<MarketGroup, string> = {
  volatility: 'Volatility',
  '1s': '1s',
  jump: 'Jump',
  daily: 'Bear/Bull'
};

const GROUP_ORDER: MarketGroup[] = ['volatility', '1s', 'jump', 'daily'];

export function MarketMultiSelect() {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);

  const settings = useStore((state) => state.settings);
  const markets = useStore((state) => state.markets);
  const toggleSubscribedMarket = useStore((state) => state.toggleSubscribedMarket);
  const setSubscribedMarkets = useStore((state) => state.setSubscribedMarkets);

  const subscribedMarkets: string[] = Array.isArray(settings.subscribedMarkets)
    ? settings.subscribedMarkets
    : [...ALL_MARKET_SYMBOLS];

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsOpen(false);
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('keydown', handleEscape);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isOpen]);

  const filteredCatalog = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return SYNTHETIC_MARKET_CATALOG;
    return SYNTHETIC_MARKET_CATALOG.filter(
      (m) =>
        m.name.toLowerCase().includes(q) ||
        m.symbol.toLowerCase().includes(q) ||
        m.shortName.toLowerCase().includes(q)
    );
  }, [searchQuery]);

  const toggleGroup = (group: MarketGroup) => {
    const groupSymbols = SYNTHETIC_MARKET_CATALOG.filter((m) => m.group === group).map((m) => m.symbol);
    const allInGroupSelected = groupSymbols.every((sym) => subscribedMarkets.includes(sym));

    if (allInGroupSelected) {
      setSubscribedMarkets(subscribedMarkets.filter((sym) => !groupSymbols.includes(sym)));
    } else {
      const merged = Array.from(new Set([...subscribedMarkets, ...groupSymbols]));
      setSubscribedMarkets(merged);
    }
  };

  const getSummaryLabel = () => {
    if (subscribedMarkets.length === 0) return 'None Selected';
    if (subscribedMarkets.length === ALL_MARKET_SYMBOLS.length) return `All ${ALL_MARKET_SYMBOLS.length} Indices`;
    if (subscribedMarkets.length <= 2) {
      return subscribedMarkets.join(', ');
    }
    return `${subscribedMarkets.slice(0, 2).join(', ')} +${subscribedMarkets.length - 2}`;
  };

  return (
    <div ref={containerRef} className="relative font-mono">
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs transition-colors ${
          isOpen
            ? 'bg-[#18181b] border-[#00ff9c] text-[#e4e4e7]'
            : 'bg-[#111114] border-[#27272a] hover:border-[#3f3f46] text-[#e4e4e7]'
        }`}
      >
        <Radio
          size={13}
          className={subscribedMarkets.length > 0 ? 'text-[#00ff9c]' : 'text-[#71717a]'}
        />
        <span className="text-[#a1a1aa] uppercase tracking-wider text-[10px] hidden sm:inline">
          Tick Stream:
        </span>
        <span
          className={`font-bold text-[11px] px-1.5 py-0.5 rounded ${
            subscribedMarkets.length > 0
              ? 'bg-[#00ff9c]/10 text-[#00ff9c]'
              : 'bg-[#ffb000]/10 text-[#ffb000]'
          }`}
        >
          {getSummaryLabel()}
        </span>
        <ChevronDown
          size={14}
          className={`text-[#a1a1aa] transition-transform duration-150 ${isOpen ? 'rotate-180 text-[#00ff9c]' : ''}`}
        />
      </button>

      {isOpen && (
        <div
          role="listbox"
          aria-multiselectable="true"
          className="absolute left-0 sm:left-auto sm:right-0 mt-1.5 w-[310px] sm:w-[360px] bg-[#111114] border border-[#27272a] rounded-xl shadow-2xl z-50 overflow-hidden"
        >
          {/* Header & Search */}
          <div className="p-2.5 border-b border-[#27272a] space-y-2 bg-[#09090b]/60">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-wider text-[#00ff9c]">
                Subscribe to Tick Streams
              </span>
              <span className="text-[10px] text-[#71717a]">
                {subscribedMarkets.length}/{ALL_MARKET_SYMBOLS.length} active
              </span>
            </div>

            <div className="relative flex items-center">
              <Search size={13} className="absolute left-2.5 text-[#71717a]" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search indices (e.g. R_100, Jump, 1s)..."
                className="w-full bg-[#18181b] border border-[#27272a] text-[#e4e4e7] pl-8 pr-7 py-1.5 rounded text-[11px] outline-none focus:border-[#00ff9c]"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2 text-[#71717a] hover:text-[#e4e4e7]"
                >
                  <X size={12} />
                </button>
              )}
            </div>

            {/* Bulk & Group Quick Toggles */}
            <div className="flex flex-wrap items-center gap-1">
              <button
                type="button"
                onClick={() => setSubscribedMarkets([...ALL_MARKET_SYMBOLS])}
                className="px-2 py-0.5 text-[9px] uppercase font-bold rounded border border-[#27272a] bg-white/5 text-[#e4e4e7] hover:border-[#00ff9c]/50 hover:text-[#00ff9c]"
              >
                All
              </button>
              <button
                type="button"
                onClick={() => setSubscribedMarkets([])}
                className="px-2 py-0.5 text-[9px] uppercase font-bold rounded border border-[#27272a] bg-white/5 text-[#a1a1aa] hover:border-[#ff4b4b]/50 hover:text-[#ff4b4b]"
              >
                Clear
              </button>
              <span className="text-[#27272a] mx-0.5">|</span>
              {GROUP_ORDER.map((group) => {
                const groupSymbols = SYNTHETIC_MARKET_CATALOG.filter((m) => m.group === group).map((m) => m.symbol);
                const allSelected = groupSymbols.every((s) => subscribedMarkets.includes(s));
                return (
                  <button
                    key={group}
                    type="button"
                    onClick={() => toggleGroup(group)}
                    className={`px-2 py-0.5 text-[9px] uppercase font-semibold rounded border transition-colors ${
                      allSelected
                        ? 'bg-[#00ff9c]/15 border-[#00ff9c]/50 text-[#00ff9c]'
                        : 'bg-white/5 border-[#27272a] text-[#a1a1aa] hover:text-[#e4e4e7]'
                    }`}
                  >
                    {GROUP_SHORT[group]}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Scrollable Grouped Checklist */}
          <div className="max-h-72 overflow-y-auto p-2 space-y-2.5">
            {filteredCatalog.length === 0 ? (
              <div className="py-6 text-center text-[11px] text-[#71717a]">
                No synthetic indices match &ldquo;{searchQuery}&rdquo;
              </div>
            ) : (
              GROUP_ORDER.map((group) => {
                const items = filteredCatalog.filter((m) => m.group === group);
                if (items.length === 0) return null;

                return (
                  <div key={group} className="space-y-1">
                    <div className="px-1.5 text-[9px] uppercase tracking-widest text-[#71717a] font-semibold">
                      {GROUP_LABELS[group]}
                    </div>
                    {items.map((item) => {
                      const isChecked = subscribedMarkets.includes(item.symbol);
                      const marketState = markets[item.symbol];
                      const hasPrice = Boolean(marketState && marketState.currentPrice > 0);

                      return (
                        <button
                          key={item.symbol}
                          type="button"
                          role="option"
                          aria-selected={isChecked}
                          onClick={() => toggleSubscribedMarket(item.symbol)}
                          className={`w-full flex items-center justify-between gap-2 px-2 py-1.5 rounded-md text-left transition-colors border ${
                            isChecked
                              ? 'bg-[#00ff9c]/10 border-[#00ff9c]/30 text-[#e4e4e7]'
                              : 'bg-transparent border-transparent hover:bg-white/5 text-[#a1a1aa]'
                          }`}
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <div
                              className={`w-4 h-4 rounded flex items-center justify-center shrink-0 border transition-colors ${
                                isChecked
                                  ? 'bg-[#00ff9c] border-[#00ff9c] text-[#09090b]'
                                  : 'border-[#3f3f46] bg-black/40'
                              }`}
                            >
                              {isChecked && <Check size={11} strokeWidth={3} />}
                            </div>
                            <div className="min-w-0">
                              <div className="text-[11px] font-semibold truncate">
                                {item.name}
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center gap-2 shrink-0">
                            {isChecked && hasPrice && (
                              <span className="text-[10px] tabular-nums text-[#00ff9c]/80">
                                {marketState.currentPrice.toFixed(2)}
                              </span>
                            )}
                            <span
                              className={`text-[9px] px-1.5 py-0.5 rounded font-bold ${
                                isChecked
                                  ? 'bg-[#00ff9c]/15 text-[#00ff9c]'
                                  : 'bg-white/5 text-[#71717a]'
                              }`}
                            >
                              {item.symbol}
                            </span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                );
              })
            )}
          </div>

          {/* Footer */}
          <div className="px-3 py-2 border-t border-[#27272a] bg-[#09090b]/80 flex items-center justify-between">
            <span className="text-[10px] text-[#71717a]">
              {subscribedMarkets.length === 0
                ? 'Tick streaming paused'
                : `Streaming ${subscribedMarkets.length} ${subscribedMarkets.length === 1 ? 'index' : 'indices'}`}
            </span>
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              className="px-3 py-1 rounded bg-[#00ff9c] text-[#09090b] text-[10px] font-bold uppercase hover:opacity-90"
            >
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
