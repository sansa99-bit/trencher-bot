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
import { solPrice } from './solPrice.js';
import { bus } from './eventBus.js';
import { levelForScore } from './scorer.js';
const log = createLogger('alert-engine');
const RANK = {
    NONE: 0,
    WATCHLIST: 1,
    SIGNAL: 2,
    A: 3,
    A_PLUS: 4,
};
class AlertEngine {
    evaluate(input) {
        const config = loadConfig();
        const { token, score, breakdown, kind = 'EARLY' } = input;
        if (score < config.alerts.minScore)
            return false;
        const level = levelForScore(score);
        if (level === 'WATCHLIST')
            return false;
        const now = Date.now();
        const prev = token.lastAlertLevel;
        const prevScore = token.lastAlertScore ?? 0;
        const prevTs = token.lastAlertTimestamp ?? 0;
        const decision = this.decide(token, { score, level, previousLevel: prev });
        if (!decision)
            return false;
        token.lastAlertLevel = level;
        token.lastAlertScore = score;
        token.lastAlertTimestamp = now;
        token.lastAlertKind = kind;
        token.alertCount += 1;
        token.alertPrice = solPrice.get();
        token.alertMcap = token.marketCap;
        token.alertedAt = now;
        token.lastProfitLevel = 1;
        const event = { kind, level, token, score, breakdown, reason: decision.reason, ts: now };
        log.debug(`Alerte ${kind} ${level} $${token.symbol} (${decision.reason})`);
        bus.emit('alert:emit', event);
        return true;
    }
    decide(token, ctx) {
        const config = loadConfig();
        const now = Date.now();
        const prev = ctx.previousLevel;
        const prevTs = token.lastAlertTimestamp ?? 0;
        if (token.ignoredUntil && now < token.ignoredUntil)
            return null;
        if (RANK[ctx.level] > RANK[prev])
            return { reason: 'niveau monté' };
        if (ctx.level !== prev && token.lastAlertKind !== 'EARLY')
            return { reason: 'changement de kind' };
        const cooldownOk = now - prevTs >= config.alerts.cooldownMs;
        const scoreDeltaOk = ctx.score - (token.lastAlertScore ?? 0) >= config.alerts.scoreDelta;
        if (!cooldownOk || !scoreDeltaOk)
            return null;
        return { reason: 'cooldown + score' };
    }
}
export const alertEngine = new AlertEngine();
