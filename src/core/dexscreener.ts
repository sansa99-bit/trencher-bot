import { bus } from './eventBus.js';
import { tokenStore } from './tokenStore.js';
import { createLogger } from '../util/logger.js';
import { checkProfitMilestones } from './pipeline.js';
import type { TokenState } from './types.js';

const log = createLogger('dexscreener');

const BATCH_SIZE = 30;          // max d'adresses par requête
const CYCLE_MS = 7_000;        // un lot toutes les 20s
const LOCAL_FRESH_MS = 30_000;  // en deçà, les données on-chain priment

interface DexPair {
  dexId?: string;
  baseToken?: { address?: string; symbol?: string; name?: string };
  marketCap?: number;
  fdv?: number;
  liquidity?: { usd?: number };
  volume?: { m5?: number; h1?: number; h6?: number; h24?: number };
  txns?: Record<string, { buys?: number; sells?: number }>;
  priceChange?: { m5?: number; h1?: number; h24?: number };
  pairCreatedAt?: number;
}

let cursor = 0;
let timer: NodeJS.Timeout | null = null;
let enriched = 0;
let errors = 0;

async function fetchBatch(mints: string[]): Promise<DexPair[]> {
  const url = `https://api.dexscreener.com/latest/dex/tokens/${mints.join(',')}`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = (await res.json()) as { pairs?: DexPair[] };
  return data.pairs ?? [];
}

/** Garde la paire la plus liquide par mint. */
function bestPerMint(pairs: DexPair[]): Map<string, DexPair> {
  const out = new Map<string, DexPair>();
  for (const p of pairs) {
    const mint = p.baseToken?.address;
    if (!mint) continue;
    const cur = out.get(mint);
    if (!cur || (p.liquidity?.usd ?? 0) > (cur.liquidity?.usd ?? 0)) out.set(mint, p);
  }
  return out;
}

function apply(token: TokenState, pair: DexPair): void {
  const now = Date.now();
  token.enrichedAt = now;

  // Le nom n'est écrasé que s'il est resté générique
  const sym = pair.baseToken?.symbol?.trim();
  const junk = new Set(['pump.fun', 'pumpfun', 'unknown', 'sol', 'wsol']);
  if (sym && !junk.has(sym.toLowerCase()) && token.name === 'Unknown') {
    token.symbol = sym;
    if (pair.baseToken?.name) token.name = pair.baseToken.name;
  }

  // Un dex autre que pumpfun signifie que le token a quitté sa courbe
  if (pair.dexId && pair.dexId !== 'pumpfun' && token.phase === 'PRE_MIGRATION') {
    token.phase = 'MIGRATED';
    token.migratedAt = now;
    token.migrationMarketCap = pair.marketCap ?? pair.fdv;
    token.bondingCurveProgress = 1;
    log.info(`MIGRATION détectée $${token.symbol} → ${pair.dexId}`);
    bus.emit('token:migrated', token);
  }

  // On ne touche pas aux métriques d'un token nourri en direct
  const localFresh = token.phase !== 'MIGRATED'
    && token.lastTradeAt
    && now - token.lastTradeAt < LOCAL_FRESH_MS;
  if (localFresh) return;

  const mcap = pair.marketCap ?? pair.fdv;
  if (mcap && mcap > 0) {
    token.marketCap = mcap;
    if (token.firstMarketCap === undefined) token.firstMarketCap = mcap;
    if (!token.athMarketCap || mcap > token.athMarketCap) {
      token.athMarketCap = mcap;
      token.athAt = now;
    }
  }
  if (pair.liquidity?.usd) token.liquidityUsd = pair.liquidity.usd;

  const v = pair.volume ?? {};
  if (v.m5 !== undefined) token.volume.volume5m = v.m5;
  if (v.h1 !== undefined) token.volume.volume1m = v.h1 / 60;

  const t5 = pair.txns?.m5;
  if (t5) {
    const buys = t5.buys ?? 0;
    const sells = t5.sells ?? 0;
    // Comptes de transactions, pas de wallets uniques — approximation assumée
    token.volume.tradeCount1m = Math.round((buys + sells) / 5);
    token.volume.buySellRatio = sells > 0 ? buys / sells : buys > 0 ? 3 : undefined;
    if (buys + sells > 0 && token.phase !== 'MIGRATED') token.lastTradeAt = now;
  }

  token.narrative = deriveNarrative(pair);
}

function deriveNarrative(pair: DexPair): TokenState['narrative'] {
  const m5 = pair.volume?.m5 ?? 0;
  const h1 = pair.volume?.h1 ?? 0;
  const expected5m = h1 / 12;           // rythme moyen de la dernière heure
  if (expected5m <= 0) return 'FLAT';
  const accel = m5 / expected5m;
  const chg = pair.priceChange?.m5 ?? 0;
  if (accel >= 2 && chg > 0) return 'ACCELERATING';
  if (accel >= 1.2) return 'BUILDING';
  return 'FLAT';
}

async function cycle(): Promise<void> {
  const all = tokenStore.all();
  if (all.length === 0) return;

  if (cursor >= all.length) cursor = 0;
  const batch = all.slice(cursor, cursor + BATCH_SIZE);
  cursor += BATCH_SIZE;
  if (batch.length === 0) return;

  try {
    const pairs = await fetchBatch(batch.map((t) => t.mint));
    const best = bestPerMint(pairs);
    for (const token of batch) {
      const pair = best.get(token.mint);
      if (!pair) continue;
      apply(token, pair);
      checkProfitMilestones(token);
      enriched++;
      bus.emit('token:updated', token);
    }
  } catch (err) {
    errors++;
    log.debug('Lot DexScreener échoué:', err);
  }
}

export function startDexEnricher(): () => void {
  timer = setInterval(() => void cycle(), CYCLE_MS);
  timer.unref();

  const statsTimer = setInterval(() => {
    if (enriched > 0 || errors > 0) {
      log.info(`Enrichissement: ${enriched} token(s), ${errors} erreur(s) sur 5 min.`);
      enriched = 0;
      errors = 0;
    }
  }, 300_000);
  statsTimer.unref();

  log.info('Enrichissement DexScreener actif.');
  return () => {
    if (timer) clearInterval(timer);
    clearInterval(statsTimer);
    timer = null;
  };
}
