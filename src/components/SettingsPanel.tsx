import React, { useState, useEffect } from 'react';
import { Settings as SettingsIcon, X, TrendingUp, Hash, Clock, Globe, Check } from 'lucide-react';
import { useStore, StrategyType, ALL_MARKET_SYMBOLS } from '../store/useStore';

const TIMEFRAME_OPTIONS = [
  { value: 60, label: '1 Minute (1m)', defaultDuration: 1, durationUnit: 'm' },
  { value: 120, label: '2 Minutes (2m)', defaultDuration: 2, durationUnit: 'm' },
  { value: 180, label: '3 Minutes (3m)', defaultDuration: 3, durationUnit: 'm' },
  { value: 300, label: '5 Minutes (5m)', defaultDuration: 5, durationUnit: 'm' },
  { value: 600, label: '10 Minutes (10m)', defaultDuration: 10, durationUnit: 'm' },
  { value: 900, label: '15 Minutes (15m)', defaultDuration: 15, durationUnit: 'm' },
  { value: 1800, label: '30 Minutes (30m)', defaultDuration: 30, durationUnit: 'm' },
  { value: 3600, label: '1 Hour (1h)', defaultDuration: 60, durationUnit: 'm' },
];

const MARKET_LIST: Array<{ symbol: string; name: string; group: 'volatility' | '1s' | 'jump' | 'daily' }> = [
  { symbol: 'R_10', name: 'Volatility 10', group: 'volatility' },
  { symbol: 'R_25', name: 'Volatility 25', group: 'volatility' },
  { symbol: 'R_50', name: 'Volatility 50', group: 'volatility' },
  { symbol: 'R_75', name: 'Volatility 75', group: 'volatility' },
  { symbol: 'R_100', name: 'Volatility 100', group: 'volatility' },
  { symbol: '1HZ10V', name: 'Volatility 10 (1s)', group: '1s' },
  { symbol: '1HZ25V', name: 'Volatility 25 (1s)', group: '1s' },
  { symbol: '1HZ50V', name: 'Volatility 50 (1s)', group: '1s' },
  { symbol: '1HZ75V', name: 'Volatility 75 (1s)', group: '1s' },
  { symbol: '1HZ100V', name: 'Volatility 100 (1s)', group: '1s' },
  { symbol: 'JD10', name: 'Jump 10', group: 'jump' },
  { symbol: 'JD25', name: 'Jump 25', group: 'jump' },
  { symbol: 'JD50', name: 'Jump 50', group: 'jump' },
  { symbol: 'JD75', name: 'Jump 75', group: 'jump' },
  { symbol: 'JD100', name: 'Jump 100', group: 'jump' },
  { symbol: 'RDBEAR', name: 'Bear Market', group: 'daily' },
  { symbol: 'RDBULL', name: 'Bull Market', group: 'daily' }
];

export function SettingsPanel() {
  const [isOpen, setIsOpen] = useState(false);
  const settings = useStore(state => state.settings);
  const setSettings = useStore(state => state.setSettings);

  const getInitialSelectedMarkets = (): string[] => {
    if (Array.isArray(settings.selectedMarkets)) return settings.selectedMarkets;
    if (settings.selectedMarket && settings.selectedMarket !== 'ALL' && settings.selectedMarket !== 'CUSTOM') {
      return [settings.selectedMarket];
    }
    return [...ALL_MARKET_SYMBOLS];
  };

  const [selectedStrategy, setSelectedStrategy] = useState<StrategyType>(settings.strategy || 'DIGIT_OVER');
  const [selectedTimeframe, setSelectedTimeframe] = useState<number>(settings.timeframe || 60);
  const [selectedTradeDuration, setSelectedTradeDuration] = useState<number>(settings.tradeDuration || 1);
  const [selectedTradeDurationUnit, setSelectedTradeDurationUnit] = useState<'m' | 't' | 's'>(settings.tradeDurationUnit || 'm');
  const [selectedMarkets, setSelectedMarkets] = useState<string[]>(getInitialSelectedMarkets);

  useEffect(() => {
    if (isOpen) {
      setSelectedStrategy(settings.strategy || 'DIGIT_OVER');
      setSelectedTimeframe(settings.timeframe || 60);
      setSelectedTradeDuration(settings.tradeDuration || 1);
      setSelectedTradeDurationUnit(settings.tradeDurationUnit || 'm');
      setSelectedMarkets(getInitialSelectedMarkets());
    }
  }, [isOpen, settings]);

  const toggleMarket = (symbol: string) => {
    setSelectedMarkets(prev =>
      prev.includes(symbol) ? prev.filter(s => s !== symbol) : [...prev, symbol]
    );
  };

  const selectByGroup = (group: 'volatility' | '1s' | 'jump') => {
    setSelectedMarkets(MARKET_LIST.filter(m => m.group === group).map(m => m.symbol));
  };

  const handleTimeframeChange = (tfSec: number) => {
    setSelectedTimeframe(tfSec);
    const found = TIMEFRAME_OPTIONS.find(o => o.value === tfSec);
    if (found) {
      setSelectedTradeDuration(found.defaultDuration);
      setSelectedTradeDurationUnit(found.durationUnit as 'm');
    }
  };

  const handleSave = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const derivedSelectedMarket =
      selectedMarkets.length === ALL_MARKET_SYMBOLS.length
        ? 'ALL'
        : selectedMarkets.length === 1
          ? selectedMarkets[0]
          : 'CUSTOM';

    const newSettings = {
      apiToken: settings.apiToken || '',
      appId: settings.appId || '1089',
      globalStake: Number(fd.get('globalStake')) || 1,
      targetStreak: Number(fd.get('targetStreak')) || settings.targetStreak || 3,
      takeProfit: Number(fd.get('takeProfit')) || 10,
      stopLoss: Number(fd.get('stopLoss')) || 20,
      useSchedule: fd.get('useSchedule') === 'on',
      startTime: (fd.get('startTime') as string) || '08:00',
      stopTime: (fd.get('stopTime') as string) || '17:00',
      strategy: selectedStrategy,
      timeframe: Number(selectedTimeframe),
      tradeDuration: Number(selectedTradeDuration),
      tradeDurationUnit: selectedTradeDurationUnit,
      selectedMarket: derivedSelectedMarket,
      selectedMarkets: selectedMarkets
    };

    setSettings(newSettings);
    window.dispatchEvent(new CustomEvent('bot_settings_changed', { detail: newSettings }));
    setIsOpen(false);
  };

  return (
    <>
      <button 
        id="settings-open-btn"
        onClick={() => setIsOpen(true)} 
        className="p-2 text-[#a1a1aa] hover:text-[#e4e4e7] transition-colors rounded hover:bg-white/5"
        title="Settings & Strategy"
      >
        <SettingsIcon size={20} />
      </button>

      {isOpen && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-3 sm:p-6 overflow-y-auto">
          <div className="bg-[#111114] border border-[#27272a] w-full max-w-xl p-5 sm:p-6 relative rounded-lg max-h-[95vh] overflow-y-auto shadow-2xl">
            <button 
              onClick={() => setIsOpen(false)} 
              className="absolute top-4 right-4 text-[#a1a1aa] hover:text-[#e4e4e7] p-1"
            >
              <X size={20} />
            </button>
            
            <div className="flex items-center gap-2 mb-4">
              <h2 className="text-[14px] font-bold text-[#00ff9c] uppercase tracking-widest">
                System & Strategy Configuration
              </h2>
            </div>
            
            <form onSubmit={handleSave} className="space-y-5 font-mono text-sm">
              {/* Strategy Selector */}
              <div className="space-y-2">
                <label className="text-[10px] uppercase text-[#a1a1aa] font-semibold tracking-widest flex items-center gap-1.5">
                  <TrendingUp size={12} className="text-[#00ff9c]" />
                  Trading Strategy
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setSelectedStrategy('RISE_FALL')}
                    className={`p-3 rounded border text-left transition-all ${
                      selectedStrategy === 'RISE_FALL'
                        ? 'bg-[#00ff9c]/10 border-[#00ff9c] text-[#00ff9c]'
                        : 'bg-black/30 border-[#27272a] text-[#a1a1aa] hover:border-[#3f3f46]'
                    }`}
                  >
                    <div className="flex items-center justify-between font-bold text-[12px]">
                      <span>Rise & Fall (Momentum)</span>
                      <span className="text-[9px] px-1.5 py-0.5 rounded bg-[#00ff9c]/20 text-[#00ff9c]">NEW</span>
                    </div>
                    <p className="text-[10px] text-[#71717a] mt-1">
                      Trades RISE if previous candle was bullish, FALL if previous candle was bearish.
                    </p>
                  </button>

                  <button
                    type="button"
                    onClick={() => setSelectedStrategy('DIGIT_OVER')}
                    className={`p-3 rounded border text-left transition-all ${
                      selectedStrategy === 'DIGIT_OVER'
                        ? 'bg-[#00ff9c]/10 border-[#00ff9c] text-[#00ff9c]'
                        : 'bg-black/30 border-[#27272a] text-[#a1a1aa] hover:border-[#3f3f46]'
                    }`}
                  >
                    <div className="flex items-center justify-between font-bold text-[12px]">
                      <span>Digit Over 1</span>
                      <Hash size={13} />
                    </div>
                    <p className="text-[10px] text-[#71717a] mt-1">
                      Scans for consecutive 0/1 streaks and executes Over 1 high-probability trade.
                    </p>
                  </button>
                </div>
              </div>

              {/* Rise & Fall Specific Parameters */}
              {selectedStrategy === 'RISE_FALL' && (
                <div className="p-3.5 bg-black/40 border border-[#27272a] rounded space-y-4">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-[#00ff9c] flex items-center gap-1.5">
                    <Clock size={12} />
                    Rise & Fall Timeframe & Execution
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="flex flex-col gap-1">
                      <label className="text-[10px] uppercase text-[#a1a1aa] font-semibold tracking-wider">
                        Candle Timeframe
                      </label>
                      <select
                        value={selectedTimeframe}
                        onChange={(e) => handleTimeframeChange(Number(e.target.value))}
                        className="bg-[#18181b] border border-[#27272a] text-[#00ff9c] px-3 py-2 outline-none font-mono text-[12px] rounded focus:border-[#00ff9c]"
                      >
                        {TIMEFRAME_OPTIONS.map(opt => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                      <span className="text-[9px] text-[#71717a]">
                        Granularity of previous candle evaluated for signal.
                      </span>
                    </div>

                    <div className="flex flex-col gap-1">
                      <label className="text-[10px] uppercase text-[#a1a1aa] font-semibold tracking-wider">
                        Trade Duration
                      </label>
                      <div className="flex gap-2">
                        <input
                          type="number"
                          min="1"
                          max="300"
                          value={selectedTradeDuration}
                          onChange={(e) => setSelectedTradeDuration(Math.max(1, Number(e.target.value)))}
                          className="w-2/3 bg-[#18181b] border border-[#27272a] text-[#00ff9c] px-3 py-2 outline-none text-right font-mono text-[12px] rounded focus:border-[#00ff9c]"
                          required
                        />
                        <select
                          value={selectedTradeDurationUnit}
                          onChange={(e) => setSelectedTradeDurationUnit(e.target.value as 'm' | 't' | 's')}
                          className="w-1/3 bg-[#18181b] border border-[#27272a] text-[#a1a1aa] px-2 py-2 outline-none font-mono text-[12px] rounded focus:border-[#00ff9c]"
                        >
                          <option value="m">Min</option>
                          <option value="t">Ticks</option>
                          <option value="s">Sec</option>
                        </select>
                      </div>
                      <span className="text-[9px] text-[#71717a]">
                        Contract expiration length.
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {/* Digit Over Specific Parameter */}
              {selectedStrategy === 'DIGIT_OVER' && (
                <div className="p-3.5 bg-black/40 border border-[#27272a] rounded flex flex-col gap-1">
                  <label className="text-[10px] uppercase text-[#a1a1aa] font-semibold tracking-widest">
                    Target Consecutive 0/1 Streak
                  </label>
                  <input 
                    type="number" 
                    name="targetStreak"
                    defaultValue={settings.targetStreak}
                    min="1"
                    max="10"
                    className="w-full bg-[#18181b] border border-[#27272a] text-[#00ff9c] px-3 py-2 outline-none text-right font-mono text-[12px] rounded focus:border-[#00ff9c]"
                    required
                  />
                  <span className="text-[9px] text-[#71717a]">
                    Triggers Over 1 contract when consecutive digits (0 or 1) reaches this threshold.
                  </span>
                </div>
              )}

              {/* Tradable Markets Multi-Selector (Shared for Both Strategies) */}
              <div className="p-3.5 bg-black/40 border border-[#27272a] rounded space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <label className="text-[10px] uppercase text-[#00ff9c] font-bold tracking-wider flex items-center gap-1.5">
                    <Globe size={12} />
                    Tradable Markets ({selectedMarkets.length}/{MARKET_LIST.length})
                  </label>
                  <div className="flex flex-wrap gap-1">
                    <button
                      type="button"
                      onClick={() => setSelectedMarkets([...ALL_MARKET_SYMBOLS])}
                      className="px-2 py-0.5 text-[9px] uppercase rounded border border-[#27272a] bg-white/5 text-[#e4e4e7] hover:border-[#00ff9c]/50 hover:text-[#00ff9c]"
                    >
                      All
                    </button>
                    <button
                      type="button"
                      onClick={() => selectByGroup('volatility')}
                      className="px-2 py-0.5 text-[9px] uppercase rounded border border-[#27272a] bg-white/5 text-[#a1a1aa] hover:text-[#e4e4e7]"
                    >
                      Volatility
                    </button>
                    <button
                      type="button"
                      onClick={() => selectByGroup('1s')}
                      className="px-2 py-0.5 text-[9px] uppercase rounded border border-[#27272a] bg-white/5 text-[#a1a1aa] hover:text-[#e4e4e7]"
                    >
                      1s Indices
                    </button>
                    <button
                      type="button"
                      onClick={() => selectByGroup('jump')}
                      className="px-2 py-0.5 text-[9px] uppercase rounded border border-[#27272a] bg-white/5 text-[#a1a1aa] hover:text-[#e4e4e7]"
                    >
                      Jump
                    </button>
                    <button
                      type="button"
                      onClick={() => setSelectedMarkets([])}
                      className="px-2 py-0.5 text-[9px] uppercase rounded border border-[#27272a] bg-white/5 text-[#a1a1aa] hover:border-[#ff4b4b]/50 hover:text-[#ff4b4b]"
                    >
                      Clear
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 max-h-44 overflow-y-auto pr-1">
                  {MARKET_LIST.map((m) => {
                    const isChecked = selectedMarkets.includes(m.symbol);
                    return (
                      <button
                        key={m.symbol}
                        type="button"
                        onClick={() => toggleMarket(m.symbol)}
                        className={`flex items-center justify-between gap-1.5 px-2.5 py-1.5 rounded border text-left transition-all ${
                          isChecked
                            ? 'bg-[#00ff9c]/10 border-[#00ff9c]/50 text-[#00ff9c]'
                            : 'bg-[#18181b] border-[#27272a] text-[#71717a] hover:border-[#3f3f46] hover:text-[#a1a1aa]'
                        }`}
                      >
                        <div className="min-w-0">
                          <div className="text-[10px] font-bold truncate">{m.name}</div>
                          <div className="text-[9px] opacity-75">{m.symbol}</div>
                        </div>
                        <div className={`w-3.5 h-3.5 rounded-sm flex items-center justify-center shrink-0 border ${
                          isChecked ? 'bg-[#00ff9c] border-[#00ff9c] text-[#09090b]' : 'border-[#3f3f46]'
                        }`}>
                          {isChecked && <Check size={9} strokeWidth={3} />}
                        </div>
                      </button>
                    );
                  })}
                </div>

                <span className="block text-[9px] text-[#71717a]">
                  Live data streams for all 17 indices. Auto-trading only executes on the selected markets above.
                </span>
              </div>

              {/* Financial Risk Parameters */}
              <div className="grid grid-cols-3 gap-3">
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] uppercase text-[#a1a1aa] font-semibold tracking-widest">
                    Base Stake ($)
                  </label>
                  <input 
                    type="number" 
                    name="globalStake"
                    defaultValue={settings.globalStake}
                    className="w-full bg-black/30 border border-[#27272a] text-[#00ff9c] px-3 py-2 outline-none text-right font-mono text-[12px] rounded focus:border-[#00ff9c]"
                    step="0.01"
                    required
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] uppercase text-[#a1a1aa] font-semibold tracking-widest">
                    Take Profit ($)
                  </label>
                  <input 
                    type="number" 
                    name="takeProfit"
                    defaultValue={settings.takeProfit}
                    className="w-full bg-black/30 border border-[#27272a] text-[#00ff9c] px-3 py-2 outline-none text-right font-mono text-[12px] rounded focus:border-[#00ff9c]"
                    required
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] uppercase text-[#a1a1aa] font-semibold tracking-widest">
                    Stop Loss ($)
                  </label>
                  <input 
                    type="number" 
                    name="stopLoss"
                    defaultValue={settings.stopLoss}
                    className="w-full bg-black/30 border border-[#27272a] text-[#00ff9c] px-3 py-2 outline-none text-right font-mono text-[12px] rounded focus:border-[#00ff9c]"
                    required
                  />
                </div>
              </div>

              {/* Daily Schedule */}
              <div className="pt-3 border-t border-[#27272a] space-y-3">
                <div className="flex items-center gap-2">
                  <input 
                    type="checkbox" 
                    name="useSchedule" 
                    id="useSchedule"
                    defaultChecked={settings.useSchedule}
                    className="accent-[#00ff9c]" 
                  />
                  <label htmlFor="useSchedule" className="text-[10px] uppercase text-[#a1a1aa] font-semibold tracking-widest">
                    Enable Daily Schedule
                  </label>
                </div>
                
                <div className="grid grid-cols-2 gap-4">
                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] uppercase text-[#a1a1aa] font-semibold tracking-widest">Start Time</label>
                    <input 
                      type="time" 
                      name="startTime"
                      defaultValue={settings.startTime}
                      className="w-full bg-black/30 border border-[#27272a] text-[#a1a1aa] px-3 py-2 outline-none font-mono text-[12px] rounded focus:border-[#00ff9c]"
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] uppercase text-[#a1a1aa] font-semibold tracking-widest">Stop Time</label>
                    <input 
                      type="time" 
                      name="stopTime"
                      defaultValue={settings.stopTime}
                      className="w-full bg-black/30 border border-[#27272a] text-[#a1a1aa] px-3 py-2 outline-none font-mono text-[12px] rounded focus:border-[#00ff9c]"
                    />
                  </div>
                </div>
              </div>

              <div className="pt-3 border-t border-[#27272a] flex justify-end gap-2">
                <button 
                  type="button" 
                  onClick={() => setIsOpen(false)}
                  className="px-4 py-2 text-[#a1a1aa] hover:text-[#e4e4e7] uppercase tracking-wider text-[11px] rounded"
                >
                  Cancel
                </button>
                <button 
                  type="submit" 
                  className="bg-[#00ff9c] text-[#09090b] px-6 py-2 font-bold uppercase tracking-wider rounded transition-colors hover:opacity-90 text-[12px]"
                >
                  Save & Apply
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
