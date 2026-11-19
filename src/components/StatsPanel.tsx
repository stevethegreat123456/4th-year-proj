import React from 'react';
import { useStore } from '../store/useStore';

export function StatsPanel() {
  const sessionPnL = useStore(state => state.sessionPnL);
  const wins = useStore(state => state.wins);
  const losses = useStore(state => state.losses);
  const saveAndResetSession = useStore(state => state.saveAndResetSession);
  const takeProfit = useStore(state => state.settings.takeProfit);
  const stopLoss = useStore(state => state.settings.stopLoss);
  const baseStake = useStore(state => state.settings.globalStake);
  const currentStake = useStore(state => state.currentStake);

  const totalTrades = wins + losses;
  const winRate = totalTrades === 0 ? 0 : (wins / totalTrades) * 100;
  const isInRecovery = currentStake > baseStake + 0.001;

  return (
    <div className="flex flex-col gap-4 h-full">
      <div className="text-[10px] uppercase text-[#a1a1aa] font-semibold tracking-wider">Session</div>
      
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-2 gap-3">
        <div className="bg-black/20 p-3 rounded-md border border-[#27272a]">
          <div className="text-[10px] uppercase text-[#a1a1aa] font-semibold tracking-wider">PnL</div>
          <div className={`mt-1 font-mono text-[18px] font-bold tabular-nums ${sessionPnL >= 0 ? 'text-[#00ff9c]' : 'text-[#ff4b4b]'}`}>
            {sessionPnL >= 0 ? '+' : ''}${sessionPnL.toFixed(2)}
          </div>
        </div>
        <div className="bg-black/20 p-3 rounded-md border border-[#27272a]">
          <div className="text-[10px] uppercase text-[#a1a1aa] font-semibold tracking-wider">Win Rate</div>
          <div className="mt-1 font-mono text-[18px] font-bold text-[#e4e4e7] tabular-nums">{winRate.toFixed(1)}%</div>
        </div>
        <div className="bg-black/20 p-3 rounded-md border border-[#27272a]">
          <div className="text-[10px] uppercase text-[#a1a1aa] font-semibold tracking-wider">W / L</div>
          <div className="mt-1 font-mono text-[16px] font-bold text-[#e4e4e7] tabular-nums">
            <span className="text-[#00ff9c]">{wins}</span> / <span className="text-[#ff4b4b]">{losses}</span>
          </div>
        </div>
        <div className="bg-black/20 p-3 rounded-md border border-[#27272a]">
          <div className="text-[10px] uppercase text-[#a1a1aa] font-semibold tracking-wider">TP / SL</div>
          <div className="mt-1 font-mono text-[12px] font-bold tabular-nums">
            <span className="text-[#00ff9c]">+${takeProfit}</span>{' '}
            <span className="text-[#52525b]">/</span>{' '}
            <span className="text-[#ff4b4b]">-${stopLoss}</span>
          </div>
        </div>
      </div>

      {/* Live Next Stake Indicator */}
      <div className={`p-3 rounded-md border flex items-center justify-between font-mono ${
        isInRecovery
          ? 'bg-[#ffb000]/10 border-[#ffb000]/40'
          : 'bg-black/20 border-[#27272a]'
      }`}>
        <div>
          <div className="text-[10px] uppercase text-[#a1a1aa] font-semibold tracking-wider">
            Next Stake
          </div>
          {isInRecovery && (
            <div className="text-[10px] font-bold text-[#ffb000] uppercase mt-0.5">
              Recovery Active
            </div>
          )}
        </div>
        <div className={`text-[18px] font-bold tabular-nums ${
          isInRecovery ? 'text-[#ffb000]' : 'text-[#00ff9c]'
        }`}>
          ${currentStake.toFixed(2)}
        </div>
      </div>

      <button 
        type="button"
        onClick={saveAndResetSession}
        className="w-full mt-auto py-2 text-[10px] font-mono uppercase tracking-widest text-[#a1a1aa] border border-[#27272a] rounded bg-black/20 hover:bg-[#27272a] hover:text-[#e4e4e7] transition-colors cursor-pointer"
      >
        Reset Session
      </button>
    </div>
  );
}
