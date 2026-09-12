/**
 * Moteur d'alertes : décide s'il faut notifier, et rien d'autre.
 * C'est le seul garde-fou anti-spam ; le formatter n'a aucune décision à prendre.
 *
 * Règles :
 *   score < minScore              → rien
 *   niveau WATCHLIST              → état interne, pas de notification
 *   montée de niveau              → notifie, même pendant le cooldown
 *   changement de kind (migration/re-entry) → notifie
 *   sinon                         → cooldown + hausse de score significative
 */
import { loadConfig } from '../config/env.js';
import { createLogger } from '../util/logger.js';
import { bus } from './eventBus.js';
import { levelForScore } from './scorer.js';
import type { AlertEvent, AlertKind, AlertLevel, ScoreBreakdown, TokenState } from './types.js';

const log = createLogger('alert-engine');

const RANK: Record<AlertLevel, number> = {
  NONE: 0,
  WATCHLIST: 1,
  SIGNAL: 2,
  A: 3,
  A_PLUS: 4,
};

export interface EvaluateInput {
  token: TokenState;
  score: number;
  breakdown: ScoreBreakdown;
  kind: AlertKind;
  /** Déclencheur explicite : court-circuite le cooldown (migration, re-entry). */
  trigger?: 'migration' | 'reentry';
}

class AlertEngine {
  /** @returns true si une alerte a été émise. */
  evaluate(input: EvaluateInput): boolean {
    const { token, score, breakdown, kind, trigger } = input;
    const config = loadConfig();
    const now = Date.now();

    const level = levelForScore(score);
    const previousLevel = token.lastAlertLevel;

    // L'état de niveau est tenu à jour même sans notification.
    token.lastAlertLevel = level;
    if (RANK[level] >= RANK.WATCHLIST) token.watched = true;

    const decision = this.decide(token, { score, level, previousLevel, kind, trigger, now, config });
    if (!decision.send) return false;

    token.lastAlertScore = score;
    token.lastAlertTimestamp = now;
    token.lastAlertKind = kind;
    token.alertCount += 1;

    const event: AlertEvent = { kind, level, token, score, breakdown, reason: decision.reason, ts: now };
    log.debug(`Alerte ${kind} ${level} $${token.symbol} (${decision.reason})`);
    bus.emit('alert:emit', event);
    return true;
  }

  private decide(
    token: TokenState,
    ctx: {
      score: number;
      level: AlertLevel;
      previousLevel: AlertLevel;
      kind: AlertKind;
      trigger?: 'migration' | 'reentry';
      now: number;
      config: ReturnType<typeof loadConfig>;
    },
  ): { send: boolean; reason: string } {
    const { score, level, previousLevel, kind, trigger, now, config } = ctx;

    if (token.ignoredUntil !== undefined && (token.ignoredUntil === 0 || now < token.ignoredUntil)) {
      return { send: false, reason: 'token ignoré' };
    }
    if (score < config.alerts.minScore) return { send: false, reason: 'sous le seuil' };
    if (RANK[level] < RANK.SIGNAL) return { send: false, reason: 'watchlist interne' };

    if (token.lastAlertTimestamp === 0) return { send: true, reason: 'premier signal' };
    if (trigger === 'migration') return { send: true, reason: 'migration' };
    if (token.lastAlertKind !== kind) {
      return { send: true, reason: `${token.lastAlertKind ?? 'aucun'} → ${kind}` };
    }
    if (RANK[level] > RANK[previousLevel]) {
      return { send: true, reason: `niveau ${previousLevel} → ${level}` };
    }

    if (now - token.lastAlertTimestamp < config.alerts.cooldownMs) {
      return { send: false, reason: 'cooldown' };
    }

    const delta = score - token.lastAlertScore;
    if (delta >= config.alerts.scoreDelta) return { send: true, reason: `score +${delta}` };

    return { send: false, reason: 'pas de changement significatif' };
  }
}

export const alertEngine = new AlertEngine();
