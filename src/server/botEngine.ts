import { Server } from "socket.io";
import { getSupabase } from "./supabase.ts";

let isRunning = false;
let currentSettings: any = null;
let globalCurrentStake = 1;
let sessionPnL = 0;
let lastLostSymbol: string | null = null;
let cumulativeLoss = 0;

function stripSecretsFromSettings(settings: any) {
  if (!settings || typeof settings !== 'object') return settings;
  const { apiToken: _removedToken, ...safeSettings } = settings;
  return safeSettings;
}

async function saveSettings(settings: any) {
  try {
    const supabase = getSupabase();
    if (!supabase) return;
    await supabase.from('bot_data').upsert({
      id: 'settings',
      data: stripSecretsFromSettings(settings),
      updated_at: new Date().toISOString()
    });
  } catch (err) {
    console.error('Error saving settings:', err);
  }
}

async function saveState() {
  try {
    const supabase = getSupabase();
    if (!supabase) return;
    await supabase.from('bot_data').upsert({
      id: 'state',
      data: {
        isRunning,
        globalCurrentStake,
        sessionPnL,
        cumulativeLoss,
        lastLostSymbol: lastLostSymbol || null,
      },
      updated_at: new Date().toISOString()
    });
  } catch (err) {
    console.error('Error saving state:', err);
  }
}

async function saveTrade(tradeEvent: any) {
  try {
    const supabase = getSupabase();
    if (!supabase) return;
    const { error } = await supabase.from('bot_trades').insert({
      id: tradeEvent.id,
      market: tradeEvent.market || 'UNKNOWN',
      buy_price: tradeEvent.buyPrice || 0,
      timestamp: tradeEvent.timestamp || Date.now(),
      result: tradeEvent.result,
      pnl: tradeEvent.pnl,
      entry_tick: tradeEvent.entryTick,
      exit_tick: tradeEvent.exitTick,
      entry_digit: tradeEvent.entryDigit,
      exit_digit: tradeEvent.exitDigit,
      created_at: new Date().toISOString()
    });
    if (error) {
      console.error('Supabase error saving trade:', error);
    }
  } catch (err) {
    console.error('Error saving trade:', err);
  }
}

export async function initBot() {
  try {
    const supabase = getSupabase();
    if (!supabase) return;
    
    const { data: settingsRow } = await supabase.from('bot_data').select('data').eq('id', 'settings').single();
    if (settingsRow && settingsRow.data) {
      currentSettings = stripSecretsFromSettings(settingsRow.data);
    }
    
    const { data: stateRow } = await supabase.from('bot_data').select('data').eq('id', 'state').single();
    if (stateRow && stateRow.data) {
      const stateData = stateRow.data;
      isRunning = stateData?.isRunning || false;
      globalCurrentStake = stateData?.globalCurrentStake || 1;
      sessionPnL = stateData?.sessionPnL || 0;
      cumulativeLoss = stateData?.cumulativeLoss || 0;
      lastLostSymbol = stateData?.lastLostSymbol || null;
    }
  } catch (err) {
    console.error('Error loading DB state:', err);
  }
}

export function startBotEngine(io: Server) {
  io.on('connection', (socket) => {
    socket.emit('bot_sync', {
      isRunning,
      currentSettings,
      globalCurrentStake,
      sessionPnL,
      cumulativeLoss,
      lastLostSymbol
    });
    
    const supabase = getSupabase();
    if (supabase) {
      supabase.from('bot_trades').select('*').order('created_at', { ascending: false }).limit(50).then(({ data }) => {
        if (data && data.length > 0) {
          const pastTrades = data.reverse().map(t => ({
            type: 'TRADE_RESULT',
            id: t.id,
            market: t.market,
            buyPrice: t.buy_price,
            timestamp: t.timestamp,
            result: t.result,
            pnl: t.pnl,
            entryTick: t.entry_tick,
            exitTick: t.exit_tick,
            entryDigit: t.entry_digit,
            exitDigit: t.exit_digit
          }));
          socket.emit('past_trades', pastTrades);
        }
      }).then(undefined, err => console.error('Error fetching past trades:', err));
    }

    socket.on('worker_command', (data: any) => {
      if (data.type === 'REQUEST_SYNC') {
        socket.emit('bot_sync', {
          isRunning,
          currentSettings,
          globalCurrentStake,
          sessionPnL,
          cumulativeLoss,
          lastLostSymbol
        });
        if (supabase) {
          supabase.from('bot_trades').select('*').order('created_at', { ascending: false }).limit(50).then(({ data: tradeData }) => {
            if (tradeData && tradeData.length > 0) {
              const pastTrades = tradeData.reverse().map(t => ({
                type: 'TRADE_RESULT',
                id: t.id,
                market: t.market,
                buyPrice: t.buy_price,
                timestamp: t.timestamp,
                result: t.result,
                pnl: t.pnl,
                entryTick: t.entry_tick,
                exitTick: t.exit_tick,
                entryDigit: t.entry_digit,
                exitDigit: t.exit_digit
              }));
              socket.emit('past_trades', pastTrades);
            }
          }).then(undefined, err => console.error('Error fetching past trades sync:', err));
        }
      }

      if (data.type === 'UPDATE_SETTINGS') {
        currentSettings = stripSecretsFromSettings(data.settings);
        saveSettings(currentSettings);
        socket.broadcast.emit('bot_sync', { currentSettings });
      }

      if (data.type === 'SAVE_TRADE' && data.trade) {
        saveTrade(data.trade);
      }

      if (data.type === 'START') {
        currentSettings = stripSecretsFromSettings(data.settings);
        saveSettings(currentSettings);
        isRunning = true;
        saveState();
      }

      if (data.type === 'STOP') {
        isRunning = false;
        saveState();
      }
    });
  });
}
