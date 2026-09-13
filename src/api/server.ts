import { createServer } from 'node:http';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import express from 'express';
import { WebSocketServer } from 'ws';
import type { WebSocket } from 'ws';
import { bus } from '../core/eventBus.js';
import { tokenStore } from '../core/tokenStore.js';
import { solPrice } from '../core/solPrice.js';
import { createLogger } from '../util/logger.js';
import { walletHoldings } from './holdings.js';
import type { TokenState } from '../core/types.js';

const log = createLogger('api');
const PORT = 3001;
const WALLETS_PATH = resolve(process.cwd(), 'config/smart-wallets.json');

interface TokenRow {
  mint: string;
  symbol: string;
  name: string;
  score?: number;
  phase: string;
  marketCap?: number;
  volume5m?: number;
  holders?: number;
  narrative?: string;
  curveProgress?: number;
  smartWalletsIn: number;
  launchpad: string;
  change?: number;
  drawdown?: number;
  ageMs: number;
  watched: boolean;
  alerted: boolean;
}

function toRow(t: TokenState): TokenRow {
  return {
    mint: t.mint,
    symbol: t.symbol,
    name: t.name,
    score: t.score,
    phase: t.phase,
    marketCap: t.marketCap,
    volume5m: t.volume.volume5m,
    holders: t.holders,
    narrative: t.narrative,
    curveProgress: t.bondingCurveProgress,
    smartWalletsIn: t.smartWallets?.entered ?? 0,
    launchpad: 'Pump.fun',
    change: t.firstMarketCap && t.marketCap ? t.marketCap / t.firstMarketCap - 1 : undefined,
    drawdown: t.athMarketCap && t.marketCap ? t.marketCap / t.athMarketCap - 1 : undefined,
    ageMs: Date.now() - t.createdAt,
    watched: t.watched,
    alerted: (t.alertCount ?? 0) > 0,
  };
}

/** Vitalité : le token doit être actif MAINTENANT, pas gros. */
const ALIVE_MAX_SILENCE_MS = 120_000;
const MIN_MARKET_CAP = 5_000;
const MIN_TRADES_1M = 3;
const MIN_HOLDERS = 4;
const MIN_TURNOVER_5M = 0.12;

function isAlive(t: TokenState): boolean {
  const now = Date.now();
  if (!t.lastTradeAt || now - t.lastTradeAt > ALIVE_MAX_SILENCE_MS) return false;

  const mcap = t.marketCap ?? 0;
  if (mcap < MIN_MARKET_CAP) return false;
  if ((t.volume.tradeCount1m ?? 0) < MIN_TRADES_1M) return false;
  if ((t.holders ?? 0) < MIN_HOLDERS) return false;

  const turnover = (t.volume.volume5m ?? 0) / mcap;
  return turnover >= MIN_TURNOVER_5M;
}

function topTokens(limit = 50): TokenRow[] {
  return tokenStore
    .all()
    .filter((t) => t.score !== undefined && isAlive(t))
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .slice(0, limit)
    .map(toRow);
}

function readWallets(): string[] {
  if (!existsSync(WALLETS_PATH)) return [];
  try {
    const parsed: unknown = JSON.parse(readFileSync(WALLETS_PATH, 'utf8'));
    return Array.isArray(parsed) ? parsed.filter((w): w is string => typeof w === 'string') : [];
  } catch {
    return [];
  }
}

function writeWallets(wallets: string[]): void {
  writeFileSync(WALLETS_PATH, JSON.stringify(wallets, null, 2), 'utf8');
  tokenStore.setSmartWallets(wallets);
}

export function startApi(): () => void {
  const app = express();
  app.use(express.json());
  app.use(express.static(resolve(process.cwd(), 'public')));

  app.get('/api/tokens', (_req, res) => {
    res.json({ tokens: topTokens(), solPrice: solPrice.get(), stats: tokenStore.stats() });
  });

  app.get('/api/wallets', (_req, res) => {
    res.json({ wallets: readWallets() });
  });

  app.post('/api/wallets', (req, res) => {
    const address = String((req.body as { address?: string }).address ?? '').trim();
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) {
      res.status(400).json({ error: 'adresse invalide' });
      return;
    }
    const wallets = readWallets();
    if (!wallets.includes(address)) wallets.push(address);
    writeWallets(wallets);
    res.json({ wallets });
  });

  app.delete('/api/wallets/:address', (req, res) => {
    const wallets = readWallets().filter((w) => w !== req.params.address);
    writeWallets(wallets);
    res.json({ wallets });
  });


  app.get('/api/diag', (_req, res) => {
    const now = Date.now();
    const all = tokenStore.all();
    const fail = { noScore: 0, silence: 0, mcap: 0, trades: 0, holders: 0, turnover: 0, alive: 0 };
    const samples: any[] = [];

    for (const t of all) {
      if (t.score === undefined) { fail.noScore++; continue; }
      if (!t.lastTradeAt || now - t.lastTradeAt > ALIVE_MAX_SILENCE_MS) { fail.silence++; continue; }
      const mcap = t.marketCap ?? 0;
      if (mcap < MIN_MARKET_CAP) { fail.mcap++; continue; }
      if ((t.volume.tradeCount1m ?? 0) < MIN_TRADES_1M) {
        fail.trades++;
        if (samples.length < 8) samples.push({ sym: t.symbol, mcap, tc1m: t.volume.tradeCount1m ?? 0, hold: t.holders ?? 0, v5m: t.volume.volume5m ?? 0 });
        continue;
      }
      if ((t.holders ?? 0) < MIN_HOLDERS) { fail.holders++; continue; }
      if ((t.volume.volume5m ?? 0) / mcap < MIN_TURNOVER_5M) { fail.turnover++; continue; }
      fail.alive++;
    }
    res.json({ total: all.length, fail, samples });
  });


  app.get('/api/wallets/:address/holdings', async (req, res) => {
    try {
      const holdings = await walletHoldings(req.params.address);
      const enriched = holdings.map((h) => {
        const t = tokenStore.get(h.mint);
        return {
          ...h,
          symbol: t?.symbol ?? h.symbol,
          name: t?.name ?? h.name,
          score: t?.score,
          marketCap: t?.marketCap,
        };
      });
      res.json({ wallet: req.params.address, holdings: enriched });
    } catch (err) {
      res.status(502).json({ error: String(err) });
    }
  });

  const server = createServer(app);
  const wss = new WebSocketServer({ server });
  const clients = new Set<WebSocket>();

  wss.on('connection', (ws) => {
    clients.add(ws);
    ws.send(JSON.stringify({ type: 'snapshot', tokens: topTokens(), solPrice: solPrice.get() }));
    ws.on('close', () => clients.delete(ws));
    ws.on('error', () => clients.delete(ws));
  });

  const broadcast = (payload: unknown): void => {
    const msg = JSON.stringify(payload);
    for (const ws of clients) {
      if (ws.readyState === 1) {
        try {
          ws.send(msg);
        } catch {
          clients.delete(ws);
        }
      }
    }
  };

  const pushTimer = setInterval(() => {
    if (clients.size === 0) return;
    broadcast({ type: 'snapshot', tokens: topTokens(), solPrice: solPrice.get(), stats: tokenStore.stats() });
  }, 2000);
  pushTimer.unref();

  const offAlert = bus.on('alert:emit', (event) => {
    broadcast({ type: 'alert', mint: event.token.mint, symbol: event.token.symbol, level: event.level, score: event.score });
  });

  server.listen(PORT, () => {
    log.info(`Dashboard disponible sur http://0.0.0.0:${PORT}`);
  });

  return () => {
    clearInterval(pushTimer);
    offAlert();
    for (const ws of clients) ws.close();
    wss.close();
    server.close();
  };
}
