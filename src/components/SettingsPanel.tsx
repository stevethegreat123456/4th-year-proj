import React, { useState, useEffect } from 'react';
import { Settings as SettingsIcon, X, Hash, Binary } from 'lucide-react';
import { useStore, StrategyType, EvenOddMode } from '../store/useStore';

export function SettingsPanel() {
  const [isOpen, setIsOpen] = useState(false);
  const settings = useStore(state => state.settings);
  const setSettings = useStore(state => state.setSettings);

  const normalizeStrategy = (s?: string): StrategyType =>
    s === 'EVEN_ODD' || s === 'RISE_FALL' ? 'EVEN_ODD' : 'DIGIT_OVER';

  const [selectedStrategy, setSelectedStrategy] = useState<StrategyType>(() => normalizeStrategy(settings.strategy));
  const [evenOddMode, setEvenOddMode] = useState<EvenOddMode>(settings.evenOddMode || 'reversal');

  useEffect(() => {
    if (isOpen) {
      setSelectedStrategy(normalizeStrategy(settings.strategy));
      setEvenOddMode(settings.evenOddMode || 'reversal');
    }
  }, [isOpen, settings]);

  const handleSave = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);

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
      evenOddMode: evenOddMode,
      selectedMarkets: settings.selectedMarkets,
      subscribedMarkets: settings.subscribedMarkets
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
                  <Binary size={12} className="text-[#00ff9c]" />
                  Trading Strategy
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setSelectedStrategy('EVEN_ODD')}
                    className={`p-3 rounded border text-left transition-all ${
                      selectedStrategy === 'EVEN_ODD'
                        ? 'bg-[#38bdf8]/10 border-[#38bdf8] text-[#38bdf8]'
                        : 'bg-black/30 border-[#27272a] text-[#a1a1aa] hover:border-[#3f3f46]'
                    }`}
                  >
                    <div className="flex items-center justify-between font-bold text-[12px]">
                      <span>Even / Odd (Streak)</span>
                      <Binary size={13} />
                    </div>
                    <p className="text-[10px] text-[#71717a] mt-1">
                      Monitors consecutive Even or Odd digits and executes 1-tick DIGITEVEN / DIGITODD contracts.
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

              {/* Streak & Strategy Parameters */}
              <div className="p-3.5 bg-black/40 border border-[#27272a] rounded space-y-3">
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] uppercase text-[#a1a1aa] font-semibold tracking-widest">
                    {selectedStrategy === 'EVEN_ODD'
                      ? 'Target Consecutive Even / Odd Streak'
                      : 'Target Consecutive 0/1 Streak'}
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
                    {selectedStrategy === 'EVEN_ODD'
                      ? 'Triggers when consecutive Even or Odd digits reach this threshold.'
                      : 'Triggers Over 1 contract when consecutive digits (0 or 1) reaches this threshold.'}
                  </span>
                </div>

                {selectedStrategy === 'EVEN_ODD' && (
                  <div className="space-y-1.5 pt-2 border-t border-[#27272a]/70">
                    <label className="text-[10px] uppercase text-[#a1a1aa] font-semibold tracking-wider block">
                      Even / Odd Trade Execution
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => setEvenOddMode('reversal')}
                        className={`px-2.5 py-2 rounded border text-left transition-all ${
                          evenOddMode === 'reversal'
                            ? 'bg-[#38bdf8]/10 border-[#38bdf8] text-[#38bdf8]'
                            : 'bg-[#18181b] border-[#27272a] text-[#a1a1aa] hover:border-[#3f3f46]'
                        }`}
                      >
                        <div className="text-[11px] font-bold">Counter Streak</div>
                        <div className="text-[9px] opacity-75">Even streak → Odd • Odd streak → Even</div>
                      </button>
                      <button
                        type="button"
                        onClick={() => setEvenOddMode('follow')}
                        className={`px-2.5 py-2 rounded border text-left transition-all ${
                          evenOddMode === 'follow'
                            ? 'bg-[#38bdf8]/10 border-[#38bdf8] text-[#38bdf8]'
                            : 'bg-[#18181b] border-[#27272a] text-[#a1a1aa] hover:border-[#3f3f46]'
                        }`}
                      >
                        <div className="text-[11px] font-bold">Follow Streak</div>
                        <div className="text-[9px] opacity-75">Even streak → Even • Odd streak → Odd</div>
                      </button>
                    </div>
                  </div>
                )}
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
