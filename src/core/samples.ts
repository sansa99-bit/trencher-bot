/**
 * Collecte d'instantanés : pour chaque token, on enregistre ses métriques à
 * intervalles réguliers depuis sa découverte. Croisé plus tard avec l'issue
 * (win/rug), ça permet de savoir quels signaux PRÉCÈDENT réellement un 2x,
 * au lieu de scorer sur des pondérations posées à l'intuition.
 */
import { appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { tokenStore } from './tokenStore.js';
import { createLogger } from '../util/logger.js';

const log = createLogger('samples');
const DIR = resolve(process.cwd(), 'data');
const FILE = resolve(DIR, 'samples.ndjson');

const SAMPLE_EVERY_MS = 30_000;
const MAX_AGE_MS = 20 * 60 * 1000;   // on n'échantillonne que les 20 premières minutes
const MIN_MCAP = 3_200;

const lastSample = new Map<string, number>();

function snapshot(): void {
  const now = Date.now();
  const lines: string[] = [];

  for (const t of tokenStore.all()) {
    const age = now - t.createdAt;
    if (age > MAX_AGE_MS) continue;
    if ((t.marketCap ?? 0) < MIN_MCAP) continue;

    const last = lastSample.get(t.mint) ?? 0;
    if (now - last < SAMPLE_EVERY_MS) continue;
    lastSample.set(t.mint, now);

    const v = t.volume;
    lines.push(JSON.stringify({
      ts: now,
      mint: t.mint,
      sym: t.symbol,
      age: Math.round(age / 1000),
      score: t.score,
      mcap: Math.round(t.marketCap ?? 0),
      first: Math.round(t.firstMarketCap ?? 0),
      ath: Math.round(t.athMarketCap ?? 0),
      liq: Math.round(t.liquidityUsd ?? 0),
      v5m: Math.round(v.volume5m ?? 0),
      v1m: Math.round(v.volume1m ?? 0),
      accel: round2(v.volumeAcceleration),
      bsr: round2(v.buySellRatio),
      buyers: v.uniqueBuyers ?? 0,
      sellers: v.uniqueSellers ?? 0,
      tc1m: v.tradeCount1m ?? 0,
      avgBuy: Math.round(v.averageBuySize ?? 0),
      maxBuy: Math.round(v.largestBuy ?? 0),
      holders: t.holders ?? 0,
      hDelta: round2(t.holdersDelta),
      bDelta: round2(t.uniqueBuyersDelta),
      curve: round2(t.bondingCurveProgress),
      devSold: round2(t.devSoldPct),
      smart: t.smartWallets?.entered ?? 0,
      narr: t.narrative,
      phase: t.phase,
    }));
  }

  if (lines.length === 0) return;
  try {
    if (!existsSync(DIR)) mkdirSync(DIR, { recursive: true });
    appendFileSync(FILE, lines.join('\n') + '\n', 'utf8');
  } catch (err) {
    log.debug('Écriture samples impossible:', err);
  }
}

function round2(n: number | undefined): number | undefined {
  return n === undefined || !Number.isFinite(n) ? undefined : Math.round(n * 100) / 100;
}

export function startSampler(): () => void {
  const timer = setInterval(snapshot, 10_000);
  timer.unref();

  const cleanup = setInterval(() => {
    const now = Date.now();
    for (const [mint, ts] of lastSample) {
      if (now - ts > MAX_AGE_MS) lastSample.delete(mint);
    }
  }, 300_000);
  cleanup.unref();

  log.info('Collecte instantanes active.');
  return () => {
    clearInterval(timer);
    clearInterval(cleanup);
  };
}
