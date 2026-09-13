/**
 * Suivi des issues : chaque token vu est classé rug / réussi / neutre.
 * Persisté sur disque pour survivre aux redémarrages.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { bus } from './eventBus.js';
import { tokenStore } from './tokenStore.js';
import { createLogger } from '../util/logger.js';
const log = createLogger('outcomes');
const FILE = resolve(process.cwd(), 'data/outcomes.json');
const RUG_DRAWDOWN = 0.8; // -80% depuis l'ATH
const RUG_COLLAPSE_MCAP = 5_000; // retombé sous 5k…
const RUG_PEAK_REQUIRED = 15_000; // …après avoir dépassé 15k
const WIN_MULTIPLE = 2; // 2x depuis la découverte
let state = { scanned: 0, called: 0, outcomes: {} };
function load() {
    if (!existsSync(FILE))
        return;
    try {
        const parsed = JSON.parse(readFileSync(FILE, 'utf8'));
        if (parsed && typeof parsed.scanned === 'number')
            state = parsed;
        log.info(`${state.scanned} scan(s) historisé(s), ${Object.keys(state.outcomes).length} issue(s).`);
    }
    catch {
        log.warn('outcomes.json illisible — repart de zéro.');
    }
}
let dirty = false;
function save() {
    if (!dirty)
        return;
    try {
        writeFileSync(FILE, JSON.stringify(state), 'utf8');
        dirty = false;
    }
    catch (err) {
        log.debug('Écriture outcomes impossible:', err);
    }
}
function classify(t) {
    const mcap = t.marketCap ?? 0;
    const ath = t.athMarketCap ?? 0;
    const first = t.firstMarketCap ?? 0;
    if (ath >= RUG_PEAK_REQUIRED && mcap > 0 && mcap < RUG_COLLAPSE_MCAP)
        return 'rug';
    if (ath > 0 && mcap > 0 && 1 - mcap / ath >= RUG_DRAWDOWN)
        return 'rug';
    if (first > 0 && ath / first >= WIN_MULTIPLE)
        return 'win';
    return null;
}
export function startOutcomeTracker() {
    load();
    const offCreated = bus.on('token:created', () => {
        state.scanned++;
        dirty = true;
    });
    const offAlert = bus.on('alert:emit', () => {
        state.called++;
        dirty = true;
    });
    const scan = setInterval(() => {
        for (const t of tokenStore.all()) {
            const current = state.outcomes[t.mint];
            if (current === 'rug')
                continue; // un rug ne se rachète pas
            const verdict = classify(t);
            if (verdict && verdict !== current) {
                state.outcomes[t.mint] = verdict;
                dirty = true;
            }
        }
        save();
    }, 15_000);
    scan.unref();
    log.info('Suivi des issues actif.');
    return () => {
        clearInterval(scan);
        save();
        offCreated();
        offAlert();
    };
}
export function outcomeStats() {
    let rug = 0;
    let win = 0;
    for (const v of Object.values(state.outcomes)) {
        if (v === 'rug')
            rug++;
        else if (v === 'win')
            win++;
    }
    return { scanned: state.scanned, called: state.called, rug, win, neutral: Math.max(0, state.scanned - rug - win) };
}
