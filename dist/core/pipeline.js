import { INITIAL_REAL_TOKEN_RESERVES, INITIAL_VIRTUAL_TOKEN_RESERVES, LAMPORTS_PER_SOL, TOKEN_DECIMALS, TOTAL_SUPPLY } from '../config/scoring.js';
import { bus } from './eventBus.js';
import { alertEngine } from './alertEngine.js';
import { isReentryCandidate, scoreReentry, scoreToken } from './scorer.js';
import { tokenStore } from './tokenStore.js';
import { solPrice } from './solPrice.js';
import { requestMetadata, startMetadataResolver } from './metadata.js';
import { createLogger } from '../util/logger.js';
const log = createLogger('pipeline');
const RESCORE_MIN_INTERVAL_MS = 6_000;
const lastScoredAt = new Map();
export function startPipeline() {
    const stopMeta = startMetadataResolver();
    const offCreated = bus.on('token:created', handleCreation);
    const offTrade = bus.on('token:trade', handleTrade);
    const purgeTimer = setInterval(() => {
        const removed = tokenStore.purge();
        if (removed > 0)
            log.debug(`Purge: ${removed} token(s) inactif(s) retiré(s).`);
    }, 60_000);
    purgeTimer.unref();
    log.info('Pipeline démarré.');
    return () => {
        stopMeta();
        offCreated();
        offTrade();
        clearInterval(purgeTimer);
    };
}
function handleCreation(creation) {
    const state = tokenStore.upsert(creation);
    log.debug(`Nouveau token $${state.symbol} (${state.mint.slice(0, 8)}…)`);
}
function handleTrade(trade) {
    let state = tokenStore.get(trade.mint);
    if (!state) {
        state = tokenStore.upsert({
            ts: trade.ts,
            mint: trade.mint,
            name: 'Unknown',
            symbol: trade.mint.slice(0, 4).toUpperCase(),
            creator: '',
        });
        requestMetadata(trade.mint);
    }
    const buffer = tokenStore.buffer(trade.mint);
    if (!buffer)
        return;
    buffer.add(trade);
    state.lastTradeAt = trade.ts;
    updateCurveAndMarketCap(state, trade, buffer);
    const now = Date.now();
    const last = lastScoredAt.get(trade.mint) ?? 0;
    if (now - last < RESCORE_MIN_INTERVAL_MS)
        return;
    lastScoredAt.set(trade.mint, now);
    refreshMetrics(state, buffer, now);
    evaluate(state);
    checkProfitMilestones(state);
}
function updateCurveAndMarketCap(state, trade, buffer) {
    if (trade.virtualSolReserves === undefined || trade.virtualTokenReserves === undefined)
        return;
    const vSol = trade.virtualSolReserves / LAMPORTS_PER_SOL;
    const vTokens = trade.virtualTokenReserves / 10 ** TOKEN_DECIMALS;
    if (vTokens <= 0)
        return;
    const priceSol = vSol / vTokens;
    const marketCap = priceSol * TOTAL_SUPPLY * solPrice.get();
    state.marketCap = marketCap;
    if (state.firstMarketCap === undefined)
        state.firstMarketCap = marketCap;
    state.liquidityUsd = vSol * solPrice.get() * 2;
    if (!state.athMarketCap || marketCap > state.athMarketCap) {
        state.athMarketCap = marketCap;
        state.athAt = trade.ts;
    }
    const offset = INITIAL_VIRTUAL_TOKEN_RESERVES - INITIAL_REAL_TOKEN_RESERVES;
    const realReserves = vTokens - offset;
    const progress = 1 - realReserves / INITIAL_REAL_TOKEN_RESERVES;
    state.bondingCurveProgress = clamp01(progress);
    buffer?.recordCurve(trade.ts, state.bondingCurveProgress);
    state.bondingCurveDelta1m = buffer?.curveDelta(trade.ts);
    if (state.phase === 'PRE_MIGRATION' && state.bondingCurveProgress >= 0.995) {
        markMigrated(state);
    }
}
function markMigrated(state) {
    state.phase = 'MIGRATED';
    state.migratedAt = Date.now();
    state.migrationMarketCap = state.marketCap;
    log.info(`MIGRATION $${state.symbol}`);
    bus.emit('token:migrated', state);
    const breakdown = scoreToken(state);
    state.score = breakdown.total;
    state.scoreBreakdown = breakdown;
    alertEngine.evaluate({
        token: state,
        score: breakdown.total,
        breakdown,
        kind: 'POST_MIGRATION',
        trigger: 'migration',
    });
}
function refreshMetrics(state, buffer, now) {
    state.volume = buffer.compute(now);
    const smart = tokenStore.smartWalletSet;
    if (smart.size > 0) {
        const entered = buffer.buyersFrom(smart);
        state.smartWallets = { entered: entered.size, holding: buffer.netHolders(entered), tracked: smart.size };
    }
    const holders = buffer.netHoldersAll();
    const buyers = state.volume.uniqueBuyers ?? 0;
    buffer.recordHolders(now, holders);
    buffer.recordBuyers(now, buyers);
    state.holders = holders;
    state.holdersDelta = buffer.holdersDelta(now);
    state.uniqueBuyersDelta = buffer.buyersDelta(now);
    state.devSoldPct = state.creator ? buffer.devSoldPct(state.creator) : undefined;
    state.narrative = deriveNarrative(state);
}
function deriveNarrative(state) {
    const accel = state.volume.volumeAcceleration ?? 0;
    const buyersDelta = state.uniqueBuyersDelta ?? 0;
    if (accel >= 1.8 && buyersDelta >= 0.15)
        return 'ACCELERATING';
    if (accel >= 1.2 || buyersDelta >= 0.05)
        return 'BUILDING';
    return 'FLAT';
}
function evaluate(state) {
    const breakdown = scoreToken(state);
    const prev = state.score;
    state.score = prev === undefined ? breakdown.total : Math.round(prev * 0.6 + breakdown.total * 0.4);
    state.scoreBreakdown = breakdown;
    if (isReentryCandidate(state)) {
        const reentry = scoreReentry(state);
        state.reentryScore = reentry.total;
        state.reentryBreakdown = reentry;
        const emitted = alertEngine.evaluate({
            token: state,
            score: reentry.total,
            breakdown: reentry,
            kind: 'RE_ENTRY',
            trigger: 'reentry',
        });
        if (emitted) {
            bus.emit('token:updated', state);
            return;
        }
    }
    alertEngine.evaluate({
        token: state,
        score: breakdown.total,
        breakdown,
        kind: state.phase === 'MIGRATED' ? 'POST_MIGRATION' : 'EARLY',
    });
    bus.emit('token:updated', state);
}
const PROFIT_MILESTONES = [1.5, 2, 3, 5, 10];
function checkProfitMilestones(state) {
    if (!state.alertPrice || !state.alertMcap || !state.alertedAt)
        return;
    if (state.marketCap === undefined || state.marketCap < 10_000) {
        if (state.lastProfitLevel !== 0) {
            state.lastProfitLevel = 0;
            bus.emit('profit:update', { mint: state.mint, symbol: state.symbol, status: 'stopped', reason: 'mcap < 10k' });
        }
        return;
    }
    const multiplier = state.marketCap / state.alertMcap;
    for (const milestone of PROFIT_MILESTONES) {
        if (multiplier >= milestone && (state.lastProfitLevel ?? 0) < milestone) {
            state.lastProfitLevel = milestone;
            const elapsed = Date.now() - state.alertedAt;
            bus.emit('profit:update', {
                mint: state.mint,
                symbol: state.symbol,
                status: 'milestone',
                multiplier,
                elapsed,
                mcapStart: state.alertMcap,
                mcapCurrent: state.marketCap,
            });
            log.info(`📈 $${state.symbol} ${multiplier.toFixed(1)}X PROFIT`);
            return;
        }
    }
}
function clamp01(n) {
    if (!Number.isFinite(n))
        return 0;
    return Math.max(0, Math.min(1, n));
}
