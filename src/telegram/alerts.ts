import { bus } from '../core/eventBus.js';
import { runtime } from '../core/runtime.js';
import { createLogger } from '../util/logger.js';
import type { AlertEvent, TokenState } from '../core/types.js';
import { telegram } from './bot.js';
import { formatAlert } from './formatter.js';
import { tokenKeyboard } from './keyboards.js';

import type { ProfitUpdate } from '../core/types.js';
import { formatProfitUpdate } from './formatter.js';
const log = createLogger('alert-bridge');

export function startAlertBridge(): () => void {
  const off = bus.on('alert:emit', dispatch);
  const offProfit = bus.on('profit:update', dispatchProfit);
  const offStatus = bus.on('source:status', (status) => {
    runtime.markSourceEvent();
    telegram.broadcast(
      status.connected
        ? `🟢 Source <b>${status.name}</b> connectée.`
        : `🔴 Source <b>${status.name}</b> déconnectée${status.detail ? ` (${status.detail})` : ''}.`,
    );
  });
  const offTrade = bus.on('token:trade', () => runtime.markSourceEvent());
  log.info('Pont d\'alertes actif.');
  return () => {
    off();
    offProfit();
    offStatus();
    offTrade();
  };
}

function dispatch(event: AlertEvent): void {
  const text = formatAlert(event);
  const status = telegram.status();
  if (!status.online) {
    log.info(`\n${stripHtml(text)}\n`);
    return;
  }
  telegram.broadcast(text, { reply_markup: tokenKeyboard(event.token) });
}


function dispatchProfit(update: ProfitUpdate): void {
  const text = formatProfitUpdate(update);
  const status = telegram.status();
  if (!status.online) {
    log.info(`\n${stripHtml(text)}\n`);
    return;
  }
  telegram.broadcast(text);
}
function stripHtml(text: string): string {
  return text.replace(/<[^>]+>/g, '');
}

export function sendTestAlert(): void {
  const now = Date.now();
  const token: TokenState = {
    mint: 'TESTtoken1111111111111111111111111111111111',
    symbol: 'TRENCH',
    name: 'Trencher Test Token',
    creator: 'DEVtest1111111111111111111111111111111111111',
    createdAt: now - 138_000,
    firstSeenAt: now - 138_000,
    lastTradeAt: now,
    phase: 'PRE_MIGRATION',
    marketCap: 38_400,
    athMarketCap: 41_000,
    liquidityUsd: 22_000,
    bondingCurveProgress: 0.57,
    bondingCurveDelta1m: 0.16,
    holders: 44,
    holdersDelta: 0.18,
    uniqueBuyersDelta: 0.27,
    volume: {
      volume15s: 4_800, volume30s: 9_100, volume1m: 17_300, volume3m: 31_700, volume5m: 44_200,
      buyVolume: 27_800, sellVolume: 9_300, buySellRatio: 2.98, volumeAcceleration: 1.96,
      uniqueBuyers: 61, uniqueSellers: 19, uniqueBuyers1m: 44, averageBuySize: 455, medianBuySize: 310, largestBuy: 3_200, tradeCount1m: 73,
    },
    smartWallets: { entered: 5, holding: 4, tracked: 5 },
    narrative: 'ACCELERATING',
    devSoldPct: 0.05,
    lastAlertLevel: 'NONE',
    lastAlertScore: 0,
    lastAlertTimestamp: 0,
    alertCount: 0,
    watched: false,
  };
  const event: AlertEvent = {
    kind: 'EARLY',
    level: 'A_PLUS',
    token,
    score: 89,
    breakdown: {
      total: 89,
      parts: [
        { key: 'volume', label: '🔥 Volume', value: 19, max: 20 },
        { key: 'smartWallets', label: '🐋 Smart Wallets', value: 18, max: 20 },
        { key: 'momentum', label: '⚡ Momentum', value: 14, max: 15 },
        { key: 'buyers', label: '👥 Buyers', value: 14, max: 15 },
        { key: 'distribution', label: '📊 Distribution', value: 9, max: 10 },
        { key: 'dev', label: '👨‍💻 Dev', value: 8, max: 10 },
        { key: 'narrative', label: '🧠 Narrative', value: 7, max: 10 },
      ],
    },
    reason: 'test manuel',
    ts: now,
  };
  dispatch(event);
}
