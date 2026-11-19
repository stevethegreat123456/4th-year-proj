import React from 'react';
import { useStore } from '../store/useStore';

export function TradeLog() {
  const tradeLog = useStore((state) => state.tradeLog);

  return (
    <div className="h-full bg-black border-t border-[#27272a] px-4 py-2.5 font-mono text-[11px] overflow-y-auto">
      {tradeLog.length === 0 ? (
        <div className="text-[#71717a] h-full flex items-center justify-center">
          Awaiting signal...
        </div>
      ) : (
        <div className="space-y-1">
          {tradeLog.map((trade) => {
            const timeStr = new Date(trade.timestamp).toTimeString().slice(0, 8);
            const isWin = trade.result === 'won';
            const isLoss = trade.result === 'lost';

            return (
              <div
                key={trade.id}
                className="flex items-center justify-between gap-3 py-0.5 border-b border-[#27272a]/30 last:border-b-0 tabular-nums"
              >
                <div className="flex items-center gap-2.5 min-w-0 truncate">
                  <span className="text-[#71717a] shrink-0">{timeStr}</span>
                  <span className="font-bold text-[#e4e4e7] shrink-0">{trade.market}</span>
                  <span className="text-[#a1a1aa] shrink-0">
                    {trade.contractType || 'DIGITOVER'}
                  </span>
                  <span className="text-[#a1a1aa] shrink-0">${trade.buyPrice.toFixed(2)}</span>
                </div>
                <span
                  className={`font-bold shrink-0 ${
                    isWin ? 'text-[#00ff9c]' : isLoss ? 'text-[#ff4b4b]' : 'text-[#a1a1aa]'
                  }`}
                >
                  {trade.result === 'pending'
                    ? 'PENDING'
                    : isWin
                      ? `+$${trade.pnl.toFixed(2)}`
                      : `-$${Math.abs(trade.pnl || trade.buyPrice).toFixed(2)}`}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
