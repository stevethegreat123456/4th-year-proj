import React, { useEffect, useRef } from 'react';
import { useStore } from '../store/useStore';
import { SettingsPanel } from './SettingsPanel';
import { HistoryPanel } from './HistoryPanel';
import { MarketGrid } from './MarketGrid';
import { TradeLog } from './TradeLog';
import { StatsPanel } from './StatsPanel';
import { useWakeLock } from '../hooks/useWakeLock';
import { io, Socket } from 'socket.io-client';

import { DerivAuth } from './DerivAuth';

export function Dashboard() {
  useWakeLock();
  
  const isInitialized = useRef<boolean>(false);
  const socketRef = useRef<Socket | null>(null);
  const workerRef = useRef<Worker | null>(null);

  const [isPending, setIsPending] = React.useState(false);
  const isRunning = useStore((state) => state.isRunning);
  const setIsRunning = useStore((state) => state.setIsRunning);
  const settings = useStore((state) => state.settings);
  const sessionPnL = useStore((state) => state.sessionPnL);
  
  // Need raw store fns for the worker
  const bulkUpdateMarkets = useStore((state) => state.bulkUpdateMarkets);
  const addTrade = useStore((state) => state.addTrade);
  const updateTrade = useStore((state) => state.updateTrade);
  const incrementDigit = useStore((state) => state.incrementDigit);
  const setConnectionStatus = useStore((state) => state.setConnectionStatus);
  const setBalance = useStore((state) => state.setBalance);
  
  useEffect(() => {
    // 1. Initialize browser Web Worker for direct Deriv WebSocket streaming
    const worker = new Worker(new URL('../worker/derivWorker.ts', import.meta.url), {
      type: 'module'
    });
    workerRef.current = worker;

    // Pass initial settings to worker
    worker.postMessage({
      type: 'INIT',
      settings: useStore.getState().settings
    });

    const handleEngineEvent = (msg: any) => {
      if (!msg) return;
      if (msg.type === 'MARKET_UPDATES') {
        bulkUpdateMarkets(msg.updates);
      } else if (msg.type === 'TRADE_INIT') {
        addTrade(msg.trade);
      } else if (msg.type === 'TRADE_RESULT') {
        updateTrade(msg.id, { 
          result: msg.result, 
          pnl: msg.pnl,
          entryTick: msg.entryTick,
          exitTick: msg.exitTick,
          entryDigit: msg.entryDigit,
          exitDigit: msg.exitDigit,
          contractType: msg.contractType
        });
        socketRef.current?.emit('worker_command', { type: 'SAVE_TRADE', trade: msg });
      } else if (msg.type === 'STATE_SYNC') {
        setIsPending(false);
        if (msg.isRunning !== undefined) {
          useStore.getState().setIsRunning(msg.isRunning);
        }
        if (msg.lastLostSymbol !== undefined) {
          useStore.getState().setLastLostSymbol(msg.lastLostSymbol);
        }
        if (msg.isWaitingForRecovery !== undefined) {
          useStore.getState().setIsWaitingForRecovery(msg.isWaitingForRecovery);
        }
      } else if (msg.type === 'SCHEDULE_START') {
        useStore.getState().setIsRunning(true);
      } else if (msg.type === 'SCHEDULE_STOP') {
        useStore.getState().setIsRunning(false);
      } else if (msg.type === 'LIMIT_REACHED') {
        useStore.getState().setIsRunning(false);
        useStore.getState().saveAndResetSession();
      } else if (msg.type === 'DIGIT_STAT') {
        incrementDigit(msg.digit);
      } else if (msg.type === 'STATUS') {
        setConnectionStatus(msg.status);
      } else if (msg.type === 'BALANCE') {
        setBalance(msg.balance);
      } else if (msg.type === 'AUTH_SUCCESS') {
        useStore.getState().updateFromDerivAuth(msg.account);
      } else if (msg.type === 'AUTH_ERROR') {
        console.warn('Deriv Auth Error:', msg.message);
      } else if (msg.type === 'ERROR') {
        console.warn('Deriv WS Error:', msg.message);
      }
    };

    worker.onerror = (err) => {
      console.error('[Worker] Fatal Error:', err);
      setConnectionStatus('disconnected');
    };

    worker.onmessage = (e) => {
      handleEngineEvent(e.data);
    };

    // 2. Connect Socket.IO for persisted past trades and settings sync
    socketRef.current = io();

    socketRef.current.on('connect', () => {
      socketRef.current?.emit('worker_command', { type: 'REQUEST_SYNC' });
    });

    socketRef.current.on('bot_sync', (data) => {
      if (data.currentSettings !== undefined && data.currentSettings !== null && !isInitialized.current) {
        const localSettings = useStore.getState().settings;
        const hasLocalMarketPrefs = typeof window !== 'undefined' && localStorage.getItem('deriv_selected_markets') !== null;
        const resolvedSelectedMarkets = hasLocalMarketPrefs
          ? localSettings.selectedMarkets
          : Array.isArray(data.currentSettings.selectedMarkets)
            ? data.currentSettings.selectedMarkets
            : localSettings.selectedMarkets;
        const merged = {
          ...data.currentSettings,
          apiToken: localSettings.apiToken || data.currentSettings.apiToken || '',
          appId: localSettings.appId || data.currentSettings.appId || '1089',
          selectedMarkets: resolvedSelectedMarkets,
          selectedMarket: hasLocalMarketPrefs
            ? localSettings.selectedMarket
            : (data.currentSettings.selectedMarket || localSettings.selectedMarket)
        };
        useStore.getState().setSettings(merged);
        workerRef.current?.postMessage({ type: 'UPDATE_SETTINGS', settings: merged });
        isInitialized.current = true;
      }
    });

    socketRef.current.on('past_trades', (pastTrades) => {
      const mapped = pastTrades.map((t: any) => ({
        id: t.id,
        timestamp: t.timestamp || Date.now(), 
        market: t.market || 'R_100', 
        contractId: 0,
        buyPrice: t.buyPrice || 0,
        result: t.result,
        pnl: t.pnl,
        entryTick: t.entryTick,
        exitTick: t.exitTick,
        entryDigit: t.entryDigit,
        exitDigit: t.exitDigit,
      }));
      useStore.getState().setTradeLog(mapped);
    });

    return () => {
      worker.terminate();
      socketRef.current?.disconnect();
    };
  }, [bulkUpdateMarkets, addTrade, updateTrade, incrementDigit, setConnectionStatus, setBalance]);

  useEffect(() => {
    const handleSettingsChange = (e: any) => {
      workerRef.current?.postMessage({ type: 'UPDATE_SETTINGS', settings: e.detail });
      socketRef.current?.emit('worker_command', { type: 'UPDATE_SETTINGS', settings: e.detail });
    };
    const handleVirtualTopup = () => {
      workerRef.current?.postMessage({ type: 'TOPUP' });
    };
    window.addEventListener('bot_settings_changed', handleSettingsChange);
    window.addEventListener('deriv_topup_virtual', handleVirtualTopup);
    
    return () => {
      window.removeEventListener('bot_settings_changed', handleSettingsChange);
      window.removeEventListener('deriv_topup_virtual', handleVirtualTopup);
    };
  }, []);

  const connectionStatus = useStore((state) => state.connectionStatus);

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-[#09090b] text-[#e4e4e7] font-sans">
      <header className="h-[56px] sm:h-[64px] border-b border-[#27272a] bg-[#111114] px-3 sm:px-6 flex justify-between items-center shrink-0">
        <div className="flex items-center gap-2 sm:gap-4 overflow-x-auto whitespace-nowrap scrollbar-hide">
          <div className="font-extrabold text-[14px] sm:text-[18px] tracking-tight text-[#00ff9c] flex items-center shrink-0">
            DERIV<span className="hidden sm:inline text-[#e4e4e7] ml-1">HF-BOT_v4</span>
          </div>
          <div className="flex items-center gap-1 sm:gap-2 text-[10px] sm:text-xs font-mono shrink-0">
            <div className={`w-1.5 h-1.5 sm:w-2 sm:h-2 rounded-full ${connectionStatus === 'connected' ? 'bg-[#00ff9c] shadow-[0_0_8px_#00ff9c]' : 'bg-[#ff4b4b]'}`} />
            <span className={`w-8 ${connectionStatus === 'connected' ? 'text-[#00ff9c]' : 'text-[#ff4b4b]'}`}>
              {connectionStatus === 'connected' ? 'CONN' : 'DISC'}
            </span>
          </div>

          <div className="hidden md:flex items-center ml-2 shrink-0 font-mono text-[10px]">
            {settings.strategy === 'RISE_FALL' ? (
              <span className="bg-[#00ff9c]/10 text-[#00ff9c] border border-[#00ff9c]/30 px-2 py-0.5 rounded font-bold">
                RISE/FALL ({settings.timeframe ? (settings.timeframe >= 60 ? `${settings.timeframe / 60}m` : `${settings.timeframe}s`) : '1m'})
              </span>
            ) : (
              <span className="bg-[#ffb000]/10 text-[#ffb000] border border-[#ffb000]/30 px-2 py-0.5 rounded font-bold">
                OVER 1 (STREAK: {settings.targetStreak || 3})
              </span>
            )}
          </div>
        </div>
        <div className="flex gap-2 sm:gap-4 items-center shrink-0 ml-2">
          <DerivAuth />
          <HistoryPanel />
          <SettingsPanel />
          <button 
            disabled={isPending}
            onClick={() => {
              if (isPending) return;
              setIsPending(true);
              const nextState = !isRunning;
              if (nextState) {
                  if (!settings.apiToken) {
                      setIsPending(false);
                      return;
                  }
                  workerRef.current?.postMessage({ type: 'START', settings, sessionPnL: useStore.getState().sessionPnL });
                  socketRef.current?.emit('worker_command', { type: 'START', settings, sessionPnL: useStore.getState().sessionPnL });
              } else {
                  workerRef.current?.postMessage({ type: 'STOP' });
                  socketRef.current?.emit('worker_command', { type: 'STOP' });
              }
            }}
            className={`px-3 py-1.5 sm:px-6 sm:py-2 rounded font-bold text-[10px] sm:text-sm transition-colors whitespace-nowrap ${isPending ? 'opacity-50 cursor-not-allowed bg-gray-500 text-white' : isRunning ? 'bg-[#ff4b4b] text-[#e4e4e7]' : 'bg-[#00ff9c] text-[#09090b]'}`}
          >
            {isPending ? '...' : isRunning ? 'HALT' : 'START'}
          </button>
        </div>
      </header>

      <main className="flex-1 flex flex-col lg:flex-row overflow-hidden pb-[env(safe-area-inset-bottom)]">
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="flex-1 overflow-y-auto p-3 sm:p-5">
            <MarketGrid />
          </div>
          <div className="shrink-0 h-[120px] sm:h-[140px]">
            <TradeLog />
          </div>
        </div>

        <div className="w-full lg:w-[300px] xl:w-[320px] shrink-0 border-t lg:border-t-0 lg:border-l border-[#27272a] bg-[#111114] p-3 sm:p-5 overflow-y-auto">
          <StatsPanel />
        </div>
      </main>
    </div>
  );
}
