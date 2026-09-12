/**
 * Scoring. Aucune métrique manquante ne doit provoquer d'exception :
 * une composante absente vaut 0 et reste visible dans le breakdown.
 */
import {
  LEVEL_THRESHOLDS,
  POST_WEIGHTS,
  PRE_WEIGHTS,
  REENTRY_WEIGHTS,
} from '../config/scoring.js';
import type { AlertLevel, ScoreBreakdown, ScorePart, TokenState } from './types.js';

function ramp(value: number | undefined, lo: number, hi: number, max: number): number {
  if (value === undefined || !Number.isFinite(value) || hi === lo) return 0;
  const r = (value - lo) / (hi - lo);
  return Math.round(Math.max(0, Math.min(1, r)) * max);
}

/** Plus la valeur est basse, meilleur c'est (concentration dev, revente...). */
function rampInverse(value: number | undefined, good: number, bad: number, max: number): number {
  if (value === undefined || !Number.isFinite(value) || bad === good) return 0;
  const r = (bad - value) / (bad - good);
  return Math.round(Math.max(0, Math.min(1, r)) * max);
}

function build(parts: ScorePart[]): ScoreBreakdown {
  return { total: parts.reduce((acc, p) => acc + p.value, 0), parts };
}

/**
 * Aucune liste de smart wallets configurée : la composante est notée en
 * NEUTRE (50 %), pas à 0. Sinon elle plafonne mécaniquement le score total
 * et aucun token ne peut atteindre le seuil d'alerte.
 */
function smartWalletScore(t: TokenState, field: 'entered' | 'holding', max: number): number {
  const s = t.smartWallets;
  if (!s || s.tracked <= 0) return Math.round(max * 0.5);
  return ramp(s[field] / s.tracked, 0, field === 'entered' ? 0.6 : 0.8, max);
}

function narrativeValue(t: TokenState): number {
  switch (t.narrative) {
    case 'ACCELERATING':
      return 1;
    case 'BUILDING':
      return 0.55;
    default:
      return 0.15;
  }
}

/** Score PRE-MIGRATION (sur 100). */
export function scorePreMigration(t: TokenState): ScoreBreakdown {
  const v = t.volume;
  return build([
    { key: 'volume', label: '🔥 Volume', value: ramp(v.volume5m, 2_000, 60_000, PRE_WEIGHTS.volume), max: PRE_WEIGHTS.volume },
    { key: 'smartWallets', label: '🐋 Smart Wallets', value: smartWalletScore(t, 'entered', PRE_WEIGHTS.smartWallets), max: PRE_WEIGHTS.smartWallets },
    { key: 'momentum', label: '⚡ Momentum', value: ramp(v.volumeAcceleration, 0.8, 2.5, PRE_WEIGHTS.momentum), max: PRE_WEIGHTS.momentum },
    { key: 'buyers', label: '👥 Buyers', value: ramp(v.uniqueBuyers, 5, 60, PRE_WEIGHTS.buyers), max: PRE_WEIGHTS.buyers },
    { key: 'distribution', label: '📊 Distribution', value: ramp(v.uniqueBuyers, 3, 40, PRE_WEIGHTS.distribution), max: PRE_WEIGHTS.distribution },
    { key: 'dev', label: '👨‍💻 Dev', value: rampInverse(t.devSoldPct ?? 0, 0.02, 0.5, PRE_WEIGHTS.dev), max: PRE_WEIGHTS.dev },
    { key: 'narrative', label: '🧠 Narrative', value: ramp(narrativeValue(t), 0, 1, PRE_WEIGHTS.narrative), max: PRE_WEIGHTS.narrative },
  ]);
}

/** Score POST-MIGRATION / survivor (sur 100). */
export function scorePostMigration(t: TokenState): ScoreBreakdown {
  const v = t.volume;
  return build([
    { key: 'volume', label: '🔥 Volume', value: ramp(v.volume5m, 10_000, 150_000, POST_WEIGHTS.volume), max: POST_WEIGHTS.volume },
    { key: 'smartWallets', label: '🐋 Smart Wallets', value: smartWalletScore(t, 'holding', POST_WEIGHTS.smartWallets), max: POST_WEIGHTS.smartWallets },
    { key: 'holders', label: '👥 Buyers/Holders', value: ramp(t.holdersDelta, -0.05, 0.4, POST_WEIGHTS.holders), max: POST_WEIGHTS.holders },
    { key: 'buySell', label: '⚖️ Buy/Sell', value: ramp(v.buySellRatio, 0.8, 2.2, POST_WEIGHTS.buySell), max: POST_WEIGHTS.buySell },
    { key: 'narrative', label: '🧠 Narrative', value: ramp(narrativeValue(t), 0, 1, POST_WEIGHTS.narrative), max: POST_WEIGHTS.narrative },
    { key: 'liquidity', label: '💧 Liquidity', value: ramp(t.liquidityUsd, 5_000, 80_000, POST_WEIGHTS.liquidity), max: POST_WEIGHTS.liquidity },
  ]);
}

/** Aiguille vers le bon scorer selon la phase. */
export function scoreToken(t: TokenState): ScoreBreakdown {
  return t.phase === 'MIGRATED' ? scorePostMigration(t) : scorePreMigration(t);
}

/** Drawdown depuis l'ATH, en fraction négative (-0.38 = -38%). */
export function drawdown(t: TokenState): number | undefined {
  if (!t.athMarketCap || !t.marketCap || t.athMarketCap <= 0) return undefined;
  return (t.marketCap - t.athMarketCap) / t.athMarketCap;
}

/**
 * RE-ENTRY : token migré, corrigé depuis son ATH, qui redonne des signes de vie.
 * Hors de la fenêtre -25% / -70%, la structure est soit intacte soit cassée.
 */
export function isReentryCandidate(t: TokenState): boolean {
  if (t.phase !== 'MIGRATED') return false;
  const dd = drawdown(t);
  if (dd === undefined) return false;
  if (dd > -0.25 || dd < -0.7) return false;
  const accel = t.volume.volumeAcceleration ?? 0;
  const ratio = t.volume.buySellRatio ?? 0;
  return accel >= 1.2 && ratio >= 1.1;
}

export function scoreReentry(t: TokenState): ScoreBreakdown {
  const v = t.volume;
  const dd = drawdown(t);
  // Optimum autour de -45 % ; on s'éloigne, on perd des points.
  const ddValue =
    dd === undefined ? 0 : ramp(1 - Math.abs(Math.abs(dd) - 0.45) / 0.25, 0, 1, REENTRY_WEIGHTS.drawdown);

  return build([
    { key: 'volumeRecovery', label: '🔥 Volume Recovery', value: ramp(v.volumeAcceleration, 1, 2.5, REENTRY_WEIGHTS.volumeRecovery), max: REENTRY_WEIGHTS.volumeRecovery },
    { key: 'drawdown', label: '📉 Drawdown', value: ddValue, max: REENTRY_WEIGHTS.drawdown },
    { key: 'holders', label: '👥 Holders', value: ramp(t.holdersDelta, 0, 0.35, REENTRY_WEIGHTS.holders), max: REENTRY_WEIGHTS.holders },
    { key: 'uniqueBuyers', label: '🙋 Unique Buyers', value: ramp(t.uniqueBuyersDelta, 0, 0.45, REENTRY_WEIGHTS.uniqueBuyers), max: REENTRY_WEIGHTS.uniqueBuyers },
    { key: 'buySell', label: '⚖️ Buy/Sell', value: ramp(v.buySellRatio, 0.9, 2, REENTRY_WEIGHTS.buySell), max: REENTRY_WEIGHTS.buySell },
    { key: 'smartWallets', label: '🐋 Smart Wallets', value: smartWalletScore(t, 'holding', REENTRY_WEIGHTS.smartWallets), max: REENTRY_WEIGHTS.smartWallets },
  ]);
}

export function levelForScore(score: number): AlertLevel {
  if (score >= LEVEL_THRESHOLDS.A_PLUS) return 'A_PLUS';
  if (score >= LEVEL_THRESHOLDS.A) return 'A';
  if (score >= LEVEL_THRESHOLDS.SIGNAL) return 'SIGNAL';
  if (score >= LEVEL_THRESHOLDS.WATCHLIST) return 'WATCHLIST';
  return 'NONE';
}

export function levelLabel(level: AlertLevel): string {
  switch (level) {
    case 'A_PLUS':
      return 'A+';
    case 'A':
      return 'A';
    case 'SIGNAL':
      return 'SIGNAL';
    case 'WATCHLIST':
      return 'WATCH';
    default:
      return '—';
  }
}
