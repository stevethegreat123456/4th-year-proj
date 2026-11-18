import React, { useState } from 'react';
import { useStore } from '../store/useStore';
import { X, History } from 'lucide-react';

export function TradeLog() {
  const tradeLog = useStore((state) => state.tradeLog);
  const [showHistory, setShowHistory] = useState(false);

  return (
    <div className="relative h-full bg-black border-t border-[#27272a] p-3 px-6 font-mono text-[11px] overflow-y-auto">
      <div className="sticky top-0 right-0 flex justify-end pb-2 bg-black/80 z-10">
         <button 
           onClick={() => setShowHistory(true)}
           className="flex items-center gap-1.5 text-[10px] text-[#00ff9c] hover:text-[#e4e4e7] transition-colors uppercase tracking-widest border border-[#00ff9c]/30 px-2 py-1 rounded bg-[#00ff9c]/5"
         >
           <History size={12} />
           Full Ledger
         </button>
      </div>

      {tradeLog.length === 0 ? (
        <div className="text-[#a1a1aa] h-[calc(100%-30px)] flex items-center justify-center">AWAITING SIGNAL...</div>
      ) : (
        tradeLog.map(trade => (
          <div key={trade.id} className="mb-1 flex gap-3 flex-wrap sm:flex-nowrap">
            <span className="text-[#a1a1aa] min-w-[70px]">
              [{new Date(trade.timestamp).toISOString().split('T')[1].slice(0, -1)}]
            </span>
            <span className={`text-[#e4e4e7] ${trade.result === 'won' ? 'text-[#00ff9c]' : trade.result === 'lost' ? 'text-[#ff4b4b]' : ''}`}>
              [EXECUTION] Market: {trade.market} | Contract: <span className="font-bold">{trade.contractType || 'DIGITOVER'}</span> | ID: {trade.id.substring(0,8)} | Stake: ${trade.buyPrice.toFixed(2)} |  
              {trade.result === 'pending' ? (
                ' PENDING...'
              ) : trade.result === 'won' ? (
                ` RESULT: WIN (+$${trade.pnl.toFixed(2)})`
              ) : (
                ` RESULT: LOSS`
              )}
            </span>
          </div>
        ))
      )}

      {showHistory && (
        <div className="fixed inset-0 z-50 bg-[#09090b]/80 backdrop-blur-sm flex items-center justify-center p-2 sm:p-6">
          <div className="bg-[#111114] border border-[#27272a] rounded-lg w-full max-w-4xl max-h-[90vh] sm:h-[80vh] flex flex-col shadow-2xl">
            <div className="flex justify-between items-center p-3 sm:p-4 border-b border-[#27272a] shrink-0">
              <h2 className="text-[#00ff9c] font-mono tracking-widest uppercase text-xs sm:text-sm font-bold">Execution Ledger</h2>
              <button onClick={() => setShowHistory(false)} className="text-[#a1a1aa] hover:text-white p-1">
                <X size={20} />
              </button>
            </div>
            
            <div className="flex-1 overflow-auto p-2 sm:p-4">
              <div className="w-full overflow-x-auto pb-4">
                <table className="w-full min-w-[650px] text-left border-collapse text-[11px] font-mono">
                  <thead className="text-[#a1a1aa] sticky top-0 bg-[#111114]">
                    <tr>
                      <th className="py-2 px-3 border-b border-[#27272a] font-normal uppercase tracking-wider">Time</th>
                      <th className="py-2 px-3 border-b border-[#27272a] font-normal uppercase tracking-wider">Market</th>
                      <th className="py-2 px-3 border-b border-[#27272a] font-normal uppercase tracking-wider">Type</th>
                      <th className="py-2 px-3 border-b border-[#27272a] font-normal uppercase tracking-wider">Contract ID</th>
                      <th className="py-2 px-3 border-b border-[#27272a] font-normal uppercase tracking-wider text-right">Stake</th>
                      <th className="py-2 px-3 border-b border-[#27272a] font-normal uppercase tracking-wider text-center">Entry</th>
                      <th className="py-2 px-3 border-b border-[#27272a] font-normal uppercase tracking-wider text-center">Exit</th>
                      <th className="py-2 px-3 border-b border-[#27272a] font-normal uppercase tracking-wider text-center">Result</th>
                      <th className="py-2 px-3 border-b border-[#27272a] font-normal uppercase tracking-wider text-right">PnL</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tradeLog.map(trade => {
                      const isCallPut = trade.contractType === 'CALL' || trade.contractType === 'PUT';
                      const entryDisplay = isCallPut ? (trade.entryTick || '-') : (trade.entryDigit !== undefined && !Number.isNaN(trade.entryDigit) ? trade.entryDigit : (trade.entryTick || '-'));
                      const exitDisplay = isCallPut ? (trade.exitTick || '-') : (trade.exitDigit !== undefined && !Number.isNaN(trade.exitDigit) ? trade.exitDigit : (trade.exitTick || '-'));

                      return (
                        <tr key={trade.id} className="hover:bg-white/5 transition-colors group cursor-default">
                          <td className="py-2 px-3 border-b border-[#27272a]/50 text-[#a1a1aa]">
                            {new Date(trade.timestamp).toISOString().split('T')[1].slice(0, -1)}
                          </td>
                          <td className="py-2 px-3 border-b border-[#27272a]/50 text-[#e4e4e7] font-semibold">{trade.market}</td>
                          <td className="py-2 px-3 border-b border-[#27272a]/50">
                            <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                              trade.contractType === 'CALL'
                                ? 'bg-[#00ff9c]/15 text-[#00ff9c]'
                                : trade.contractType === 'PUT'
                                  ? 'bg-[#ff4b4b]/15 text-[#ff4b4b]'
                                  : 'bg-white/10 text-[#a1a1aa]'
                            }`}>
                              {trade.contractType || 'DIGITOVER'}
                            </span>
                          </td>
                          <td className="py-2 px-3 border-b border-[#27272a]/50 text-[#666] group-hover:text-[#a1a1aa]">
                            {trade.id}
                          </td>
                          <td className="py-2 px-3 border-b border-[#27272a]/50 text-right font-mono">${trade.buyPrice.toFixed(2)}</td>
                          <td className="py-2 px-3 border-b border-[#27272a]/50 text-center text-[#e4e4e7]">
                            {entryDisplay}
                          </td>
                          <td className={`py-2 px-3 border-b border-[#27272a]/50 text-center font-bold ${trade.result === 'lost' ? 'text-[#ff4b4b]' : trade.result === 'won' ? 'text-[#00ff9c]' : 'text-[#a1a1aa]'}`}>
                            {exitDisplay}
                          </td>
                          <td className="py-2 px-3 border-b border-[#27272a]/50 text-center">
                            {trade.result === 'pending' ? (
                              <span className="text-[#a1a1aa] animate-pulse">PENDING</span>
                            ) : trade.result === 'won' ? (
                              <span className="text-[#00ff9c]">WON</span>
                            ) : (
                              <span className="text-[#ff4b4b]">LOST</span>
                            )}
                          </td>
                          <td className={`py-2 px-3 border-b border-[#27272a]/50 text-right font-mono ${trade.pnl > 0 ? 'text-[#00ff9c]' : trade.pnl < 0 ? 'text-[#ff4b4b]' : 'text-[#a1a1aa]'}`}>
                            {trade.pnl !== 0 ? `${trade.pnl > 0 ? '+' : ''}${trade.pnl.toFixed(2)}` : '---'}
                          </td>
                        </tr>
                      );
                    })}
                    {tradeLog.length === 0 && (
                      <tr>
                        <td colSpan={9} className="text-center py-8 text-[#a1a1aa]">NO TRADES RECORDED</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
