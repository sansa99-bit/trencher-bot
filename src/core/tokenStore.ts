/**
 * Registre des tokens + buffers de trades.
 * Mémoire bornée : purge des tokens inactifs, les tokens surveillés survivent.
 */
import { TradeBuffer } from './metrics.js';
import type { Phase, TokenCreation, TokenState } from './types.js';

const INACTIVE_AFTER_MS = 15 * 60 * 1000;
const MIGRATED_INACTIVE_AFTER_MS = 6 * 60 * 60 * 1000;
const MAX_TOKENS = 3000;

export interface StoreStats {
  total: number;
  preMigration: number;
  migrated: number;
  watched: number;
  trades: number;
}

class TokenStore {
  private readonly tokens = new Map<string, TokenState>();
  private readonly buffers = new Map<string, TradeBuffer>();
  private smartWallets = new Set<string>();

  get smartWalletSet(): Set<string> {
    return this.smartWallets;
  }

  get smartWalletCount(): number {
    return this.smartWallets.size;
  }

  setSmartWallets(wallets: string[]): void {
    this.smartWallets = new Set(wallets);
  }

  get(mint: string): TokenState | undefined {
    return this.tokens.get(mint);
  }

  buffer(mint: string): TradeBuffer | undefined {
    return this.buffers.get(mint);
  }

  all(): TokenState[] {
    return [...this.tokens.values()];
  }

  upsert(creation: TokenCreation): TokenState {
    const existing = this.tokens.get(creation.mint);
    if (existing) return existing;

    const state: TokenState = {
      mint: creation.mint,
      symbol: creation.symbol,
      name: creation.name,
      creator: creation.creator,
      createdAt: creation.ts,
      firstSeenAt: Date.now(),
      lastTradeAt: creation.ts,
      phase: 'PRE_MIGRATION',
      volume: {},
      lastAlertLevel: 'NONE',
      lastAlertScore: 0,
      lastAlertTimestamp: 0,
      alertCount: 0,
      watched: false,
    };

    this.tokens.set(creation.mint, state);
    this.buffers.set(creation.mint, new TradeBuffer());
    return state;
  }

  setWatched(mint: string, watched: boolean): void {
    const token = this.tokens.get(mint);
    if (token) token.watched = watched;
  }

  /** durationMs <= 0 → ignoré définitivement. */
  setIgnored(mint: string, durationMs: number): void {
    const token = this.tokens.get(mint);
    if (!token) return;
    token.ignoredUntil = durationMs <= 0 ? 0 : Date.now() + durationMs;
  }

  top(limit: number, phase?: Phase): TokenState[] {
    return this.all()
      .filter((t) => (phase ? t.phase === phase : true))
      .filter((t) => typeof t.score === 'number')
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
      .slice(0, limit);
  }

  topReentry(limit: number): TokenState[] {
    return this.all()
      .filter((t) => typeof t.reentryScore === 'number')
      .sort((a, b) => (b.reentryScore ?? 0) - (a.reentryScore ?? 0))
      .slice(0, limit);
  }

  watchlist(): TokenState[] {
    return this.all()
      .filter((t) => t.watched)
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  }

  stats(): StoreStats {
    let trades = 0;
    for (const buffer of this.buffers.values()) trades += buffer.size;
    const all = this.all();
    return {
      total: all.length,
      preMigration: all.filter((t) => t.phase === 'PRE_MIGRATION').length,
      migrated: all.filter((t) => t.phase === 'MIGRATED').length,
      watched: all.filter((t) => t.watched).length,
      trades,
    };
  }

  /** @returns nombre de tokens retirés. */
  purge(): number {
    const now = Date.now();
    let removed = 0;

    for (const [mint, token] of this.tokens) {
      if (token.watched) continue;
      const lastActivity = Math.max(token.lastTradeAt, token.firstSeenAt, token.enrichedAt ?? 0);
      // Un token migré ne reçoit plus de trades pump.fun : il est nourri par
      // DexScreener. Sa fenêtre de survie est donc bien plus large, sinon on
      // le perd juste au moment où il devient intéressant.
      const proven = (token.holders ?? 0) >= 25 || (token.alertCount ?? 0) > 0;
      const window = token.phase === 'MIGRATED' || proven
        ? MIGRATED_INACTIVE_AFTER_MS
        : INACTIVE_AFTER_MS;
      if (now - lastActivity > window) {
        this.tokens.delete(mint);
        this.buffers.delete(mint);
        removed++;
      }
    }

    // Filet dur si le flux reste très dense.
    if (this.tokens.size > MAX_TOKENS) {
      const candidates = this.all()
        .filter((t) => !t.watched)
        .sort((a, b) => Math.max(a.lastTradeAt, a.enrichedAt ?? 0) - Math.max(b.lastTradeAt, b.enrichedAt ?? 0))
        .slice(0, this.tokens.size - MAX_TOKENS);
      for (const token of candidates) {
        this.tokens.delete(token.mint);
        this.buffers.delete(token.mint);
        removed++;
      }
    }

    return removed;
  }
}

export const tokenStore = new TokenStore();
