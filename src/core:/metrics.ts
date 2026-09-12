/**
 * TradeBuffer : fenêtre glissante de trades par token + métriques dérivées.
 *
 * Principe : toute métrique est recalculée sur une fenêtre horodatée récente.
 * Les deltas (holders, buyers, courbe) sont mesurés contre un point d'il y a
 * ~60 s, pas contre le tick précédent — sinon on mesure du bruit.
 */
import type { Trade, VolumeMetrics } from './types.js';

const RETENTION_MS = 10 * 60 * 1000;
const MAX_TRADES = 4000;
const DELTA_WINDOW_MS = 60_000;

interface Sample {
  ts: number;
  value: number;
}

function trimSamples(samples: Sample[], now: number): void {
  const cutoff = now - 5 * 60_000;
  while (samples.length > 0 && samples[0]!.ts < cutoff) samples.shift();
}

/** Valeur enregistrée la plus proche d'il y a `windowMs`. */
function sampleAt(samples: Sample[], now: number, windowMs: number): number | undefined {
  const target = now - windowMs;
  let best: Sample | undefined;
  for (const s of samples) {
    if (s.ts <= target) best = s;
    else break;
  }
  return best?.value;
}

function relativeDelta(current: number | undefined, past: number | undefined): number | undefined {
  if (current === undefined || past === undefined || past <= 0) return undefined;
  return (current - past) / past;
}

export class TradeBuffer {
  private readonly trades: Trade[] = [];
  private readonly curve: Sample[] = [];
  private readonly holders: Sample[] = [];
  private readonly buyers: Sample[] = [];

  get size(): number {
    return this.trades.length;
  }

  get lastTs(): number {
    return this.trades.length > 0 ? this.trades[this.trades.length - 1]!.ts : 0;
  }

  add(trade: Trade): void {
    this.trades.push(trade);
    const cutoff = trade.ts - RETENTION_MS;
    let drop = 0;
    while (drop < this.trades.length && this.trades[drop]!.ts < cutoff) drop++;
    if (drop > 0) this.trades.splice(0, drop);
    if (this.trades.length > MAX_TRADES) {
      this.trades.splice(0, this.trades.length - MAX_TRADES);
    }
  }

  private window(from: number, to: number): Trade[] {
    return this.trades.filter((t) => t.ts >= from && t.ts <= to);
  }

  private static sum(trades: Trade[]): number {
    let total = 0;
    for (const t of trades) total += t.usdAmount;
    return total;
  }

  compute(now: number): VolumeMetrics {
    if (this.trades.length === 0) return {};

    const w = (ms: number): Trade[] => this.window(now - ms, now);

    const w1m = w(60_000);
    const prev1m = this.window(now - 120_000, now - 60_000);

    const buys = w1m.filter((t) => t.isBuy);
    const sells = w1m.filter((t) => !t.isBuy);

    const buyVolume = TradeBuffer.sum(buys);
    const sellVolume = TradeBuffer.sum(sells);
    const current = TradeBuffer.sum(w1m);
    const previous = TradeBuffer.sum(prev1m);

    const metrics: VolumeMetrics = {
      volume15s: TradeBuffer.sum(w(15_000)),
      volume30s: TradeBuffer.sum(w(30_000)),
      volume1m: current,
      volume3m: TradeBuffer.sum(w(180_000)),
      volume5m: TradeBuffer.sum(w(300_000)),
      buyVolume,
      sellVolume,
      uniqueBuyers: new Set(buys.map((t) => t.wallet)).size,
      uniqueSellers: new Set(sells.map((t) => t.wallet)).size,
      tradeCount1m: w1m.length,
    };

    metrics.uniqueBuyers1m = metrics.uniqueBuyers;

    if (sellVolume > 0) metrics.buySellRatio = buyVolume / sellVolume;
    else if (buyVolume > 0) metrics.buySellRatio = 999;

    if (previous > 0) metrics.volumeAcceleration = current / previous;

    if (buys.length > 0) {
      const sizes = buys.map((t) => t.usdAmount).sort((a, b) => a - b);
      metrics.averageBuySize = buyVolume / sizes.length;
      const mid = Math.floor(sizes.length / 2);
      metrics.medianBuySize =
        sizes.length % 2 === 1 ? sizes[mid]! : (sizes[mid - 1]! + sizes[mid]!) / 2;
      metrics.largestBuy = sizes[sizes.length - 1];
    }

    return metrics;
  }

  // ---- Courbe de bonding ----

  recordCurve(ts: number, progress: number): void {
    this.curve.push({ ts, value: progress });
    trimSamples(this.curve, ts);
  }

  /** Variation absolue de la progression sur 1 min (0.16 = +16 points de %). */
  curveDelta(now: number): number | undefined {
    const current = this.curve.length > 0 ? this.curve[this.curve.length - 1]!.value : undefined;
    const past = sampleAt(this.curve, now, DELTA_WINDOW_MS);
    if (current === undefined || past === undefined) return undefined;
    return current - past;
  }

  // ---- Holders / buyers ----

  recordHolders(ts: number, count: number): void {
    this.holders.push({ ts, value: count });
    trimSamples(this.holders, ts);
  }

  recordBuyers(ts: number, count: number): void {
    this.buyers.push({ ts, value: count });
    trimSamples(this.buyers, ts);
  }

  holdersDelta(now: number): number | undefined {
    const current = this.holders.length > 0 ? this.holders[this.holders.length - 1]!.value : undefined;
    return relativeDelta(current, sampleAt(this.holders, now, DELTA_WINDOW_MS));
  }

  buyersDelta(now: number): number | undefined {
    const current = this.buyers.length > 0 ? this.buyers[this.buyers.length - 1]!.value : undefined;
    return relativeDelta(current, sampleAt(this.buyers, now, DELTA_WINDOW_MS));
  }

  // ---- Wallets ----

  /** Soldes nets par wallet sur la fenêtre conservée. */
  private netBalances(): Map<string, number> {
    const balances = new Map<string, number>();
    for (const t of this.trades) {
      const delta = t.isBuy ? t.tokenAmount : -t.tokenAmount;
      balances.set(t.wallet, (balances.get(t.wallet) ?? 0) + delta);
    }
    return balances;
  }

  /** Sous-ensemble de `wallets` ayant acheté au moins une fois. */
  buyersFrom(wallets: Set<string>): Set<string> {
    const found = new Set<string>();
    for (const t of this.trades) {
      if (t.isBuy && wallets.has(t.wallet)) found.add(t.wallet);
    }
    return found;
  }

  /** Combien, parmi `wallets`, ont encore un solde net positif. */
  netHolders(wallets: Set<string>): number {
    const balances = this.netBalances();
    let count = 0;
    for (const w of wallets) {
      if ((balances.get(w) ?? 0) > 0) count++;
    }
    return count;
  }

  netHoldersAll(): number {
    let count = 0;
    for (const balance of this.netBalances().values()) {
      if (balance > 0) count++;
    }
    return count;
  }

  /** Part des tokens du dev revendue (0..1). undefined s'il n'a jamais acheté. */
  devSoldPct(creator: string): number | undefined {
    let bought = 0;
    let sold = 0;
    for (const t of this.trades) {
      if (t.wallet !== creator) continue;
      if (t.isBuy) bought += t.tokenAmount;
      else sold += t.tokenAmount;
    }
    if (bought <= 0) return undefined;
    return Math.min(1, sold / bought);
  }
}
