import React, { useEffect, useRef } from 'react';
import { useStore } from '../store/useStore';
import { SettingsPanel } from './SettingsPanel';
import { HistoryPanel } from './HistoryPanel';
import { MarketGrid } from './MarketGrid';
import { TradeLog } from './TradeLog';
import { StatsPanel } from './StatsPanel';
import { BacktestLab } from './BacktestLab';
import { useWakeLock } from '../hooks/useWakeLock';
import { io, Socket } from 'socket.io-client';
import { Activity, AlertTriangle, FlaskConical, X } from 'lucide-react';

import { DerivAuth } from './DerivAuth';
import { getAuthInfo, getStoredOAuthClientId, refreshAccessToken, DEFAULT_APP_ID } from '../utils/derivAuth';

function sanitizeSettingsForServer(settings: any) {
  if (!settings || typeof settings !== 'object') return settings;
  const { apiToken: _stripped, ...safeSettings } = settings;
  return safeSettings;
}

export function Dashboard() {
  useWakeLock();
  
  const isInitialized = useRef<boolean>(false);
  const socketRef = useRef<Socket | null>(null);
  const workerRef = useRef<Worker | null>(null);

  const [isPending, setIsPending] = React.useState(false);
  const [activeView, setActiveView] = React.useState<'live' | 'backtest'>('live');
  const [alertBanner, setAlertBanner] = React.useState<{
    type: 'error' | 'warning' | 'info';
    message: string;
  } | null>(null);
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

    // Fetch runtime server config (e.g. DERIV_APP_ID from environment variable)
    fetch('/api/config')
      .then(res => res.json())
      .then(cfg => {
        if (cfg?.appId && cfg.appId !== '1089') {
          const currentAppId = useStore.getState().settings.appId;
          if (currentAppId === '1089' || !currentAppId) {
            useStore.getState().setSettings({ appId: cfg.appId });
            useStore.getState().setAuth({ appId: cfg.appId });
            workerRef.current?.postMessage({
              type: 'UPDATE_SETTINGS',
              settings: { ...useStore.getState().settings, appId: cfg.appId }
            });
          }
        }
      })
      .catch(() => {});

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
        if (msg.currentStake !== undefined) {
          useStore.getState().setCurrentStake(msg.currentStake);
        }
      } else if (msg.type === 'SCHEDULE_START') {
        useStore.getState().setIsRunning(true);
      } else if (msg.type === 'SCHEDULE_STOP') {
        useStore.getState().setIsRunning(false);
      } else if (msg.type === 'LIMIT_REACHED') {
        useStore.getState().setIsRunning(false);
        useStore.getState().saveAndResetSession();
        if (msg.message) {
          setAlertBanner({
            type: msg.message.toLowerCase().includes('profit') ? 'info' : 'warning',
            message: msg.message,
          });
        }
      } else if (msg.type === 'DIGIT_STAT') {
        incrementDigit(msg.digit);
      } else if (msg.type === 'STATUS') {
        setConnectionStatus(msg.status);
      } else if (msg.type === 'BALANCE') {
        const nextBal = Number(msg.balance);
        setBalance(nextBal);
        const state = useStore.getState();
        if (state.auth.activeAccount) {
          const activeId = state.auth.activeAccount.account;
          useStore.getState().setAuth({
            activeAccount: { ...state.auth.activeAccount, balance: nextBal },
            accounts: state.auth.accounts.map((a) =>
              a.account === activeId ? { ...a, balance: nextBal } : a
            ),
          });
        }
      } else if (msg.type === 'TOPUP_SUCCESS') {
        const balText =
          msg.balance !== undefined ? `$${Number(msg.balance).toFixed(2)}` : 'updated';
        setAlertBanner({
          type: 'info',
          message: `Demo account balance reset (${balText}).`,
        });
      } else if (msg.type === 'AUTH_SUCCESS') {
        useStore.getState().updateFromDerivAuth(msg.account);
        setAlertBanner(null);
      } else if (msg.type === 'TOKEN_EXPIRED') {
        const storedInfo = getAuthInfo(true);
        const clientId =
          getStoredOAuthClientId() ||
          useStore.getState().auth.appId ||
          useStore.getState().settings.appId ||
          DEFAULT_APP_ID;
        if (storedInfo?.refresh_token && clientId) {
          refreshAccessToken(storedInfo.refresh_token, clientId)
            .then((refreshed) => {
              const updatedSettings = {
                ...useStore.getState().settings,
                apiToken: refreshed.access_token,
                authMethod: 'oauth' as const,
              };
              useStore.getState().setSettings(updatedSettings);
              workerRef.current?.postMessage({ type: 'UPDATE_SETTINGS', settings: updatedSettings });
            })
            .catch(() => {
              setIsPending(false);
              setAlertBanner({
                type: 'warning',
                message: 'Deriv session expired. Please log in again.',
              });
            });
        } else {
          setIsPending(false);
          setAlertBanner({
            type: 'warning',
            message: 'Deriv session expired. Please log in again.',
          });
        }
      } else if (msg.type === 'AUTH_ERROR') {
        setIsPending(false);
        setAlertBanner({
          type: 'error',
          message: `Deriv Auth Error: ${msg.message || 'Authentication failed'}`,
        });
      } else if (msg.type === 'ERROR') {
        setIsPending(false);
        setAlertBanner({
          type: 'error',
          message: msg.message || 'Deriv WebSocket error occurred.',
        });
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
        const hasLocalSubscribedPrefs = typeof window !== 'undefined' && localStorage.getItem('deriv_subscribed_markets') !== null;
        const legacySelectedMarket = data.currentSettings.selectedMarket;
        const serverSelectedMarkets = Array.isArray(data.currentSettings.selectedMarkets)
          ? data.currentSettings.selectedMarkets
          : legacySelectedMarket && legacySelectedMarket !== 'ALL' && legacySelectedMarket !== 'CUSTOM'
            ? [legacySelectedMarket]
            : localSettings.selectedMarkets;
        const resolvedSelectedMarkets = hasLocalMarketPrefs
          ? localSettings.selectedMarkets
          : serverSelectedMarkets;
        const resolvedSubscribedMarkets = hasLocalSubscribedPrefs
          ? localSettings.subscribedMarkets
          : Array.isArray(data.currentSettings.subscribedMarkets)
            ? data.currentSettings.subscribedMarkets
            : localSettings.subscribedMarkets;
        const { apiToken: _ignoredServerToken, selectedMarket: _ignoredLegacyMarket, ...safeServerSettings } =
          data.currentSettings;
        const merged = {
          ...safeServerSettings,
          apiToken: localSettings.apiToken || '',
          appId: localSettings.appId || data.currentSettings.appId || '1089',
          selectedMarkets: resolvedSelectedMarkets,
          subscribedMarkets: resolvedSubscribedMarkets
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
      socketRef.current?.emit('worker_command', {
        type: 'UPDATE_SETTINGS',
        settings: sanitizeSettingsForServer(e.detail)
      });
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

  useEffect(() => {
    if (!alertBanner) return;
    const timer = setTimeout(() => setAlertBanner(null), 8000);
    return () => clearTimeout(timer);
  }, [alertBanner]);

  const connectionStatus = useStore((state) => state.connectionStatus);

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-[#09090b] text-[#e4e4e7] font-sans">
      <header className="h-[56px] sm:h-[64px] border-b border-[#27272a] bg-[#111114] px-3 sm:px-6 flex justify-between items-center shrink-0">
        <div className="flex items-center gap-2 sm:gap-4 overflow-x-auto whitespace-nowrap scrollbar-hide">
          <div className="font-extrabold text-[14px] sm:text-[18px] tracking-tight text-[#00ff9c] flex items-center shrink-0">
            DERIV<span className="hidden sm:inline text-[#e4e4e7] ml-1">BOT</span>
          </div>
          <div className="flex items-center gap-1 sm:gap-2 text-[10px] sm:text-xs font-mono shrink-0">
            <div className={`w-1.5 h-1.5 sm:w-2 sm:h-2 rounded-full ${connectionStatus === 'connected' ? 'bg-[#00ff9c] shadow-[0_0_8px_#00ff9c]' : 'bg-[#ff4b4b]'}`} />
            <span className={`w-8 ${connectionStatus === 'connected' ? 'text-[#00ff9c]' : 'text-[#ff4b4b]'}`}>
              {connectionStatus === 'connected' ? 'CONN' : 'DISC'}
            </span>
          </div>

          <div className="flex items-center bg-[#09090b] border border-[#27272a] rounded-md p-0.5 font-mono text-[11px] shrink-0">
            <button
              type="button"
              onClick={() => setActiveView('live')}
              className={`px-2.5 py-1 rounded flex items-center gap-1.5 font-semibold whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                activeView === 'live'
                  ? 'bg-[#27272a] text-[#00ff9c]'
                  : 'text-[#a1a1aa] hover:text-[#e4e4e7]'
              }`}
            >
              <Activity size={12} />
              <span>Live Monitor</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveView('backtest')}
              className={`px-2.5 py-1 rounded flex items-center gap-1.5 font-semibold whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                activeView === 'backtest'
                  ? 'bg-[#27272a] text-[#38bdf8]'
                  : 'text-[#a1a1aa] hover:text-[#e4e4e7]'
              }`}
            >
              <FlaskConical size={12} />
              <span>5K Backtester</span>
            </button>
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
                      setAlertBanner({
                        type: 'warning',
                        message: 'Log in with your Deriv account or paste an API token to start trading.',
                      });
                      window.dispatchEvent(new CustomEvent('open_deriv_login_modal'));
                      return;
                  }
                  setAlertBanner(null);
                  workerRef.current?.postMessage({ type: 'START', settings, sessionPnL: useStore.getState().sessionPnL });
                  socketRef.current?.emit('worker_command', {
                    type: 'START',
                    settings: sanitizeSettingsForServer(settings),
                    sessionPnL: useStore.getState().sessionPnL
                  });
              } else {
                  workerRef.current?.postMessage({ type: 'STOP' });
                  socketRef.current?.emit('worker_command', { type: 'STOP' });
              }
            }}
            className={`px-3 py-1.5 sm:px-6 sm:py-2 rounded font-bold text-[10px] sm:text-sm transition-colors whitespace-nowrap cursor-pointer ${isPending ? 'opacity-50 cursor-not-allowed bg-gray-500 text-white' : isRunning ? 'bg-[#ff4b4b] text-[#e4e4e7]' : 'bg-[#00ff9c] text-[#09090b]'}`}
          >
            {isPending ? '...' : isRunning ? 'HALT' : 'START'}
          </button>
        </div>
      </header>

      {alertBanner && (
        <div
          role="alert"
          className={`px-4 py-2 border-b text-xs font-mono flex items-center justify-between gap-3 shrink-0 ${
            alertBanner.type === 'error'
              ? 'bg-[#ff4b4b]/10 border-[#ff4b4b]/30 text-[#ff4b4b]'
              : alertBanner.type === 'warning'
                ? 'bg-[#ffb000]/10 border-[#ffb000]/30 text-[#ffb000]'
                : 'bg-[#00ff9c]/10 border-[#00ff9c]/30 text-[#00ff9c]'
          }`}
        >
          <div className="flex items-center gap-2 min-w-0">
            <AlertTriangle size={14} className="shrink-0" />
            <span className="truncate">{alertBanner.message}</span>
          </div>
          <button
            type="button"
            onClick={() => setAlertBanner(null)}
            className="opacity-75 hover:opacity-100 p-0.5 cursor-pointer shrink-0"
            aria-label="Dismiss alert"
          >
            <X size={14} />
          </button>
        </div>
      )}

      <main className="flex-1 flex flex-col lg:flex-row overflow-hidden pb-[env(safe-area-inset-bottom)]">
        {activeView === 'backtest' ? (
          <BacktestLab />
        ) : (
          <>
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
          </>
        )}
      </main>
    </div>
  );
}
