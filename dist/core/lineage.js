/**
 * Détection de farm : un même ticker relancé en boucle, ou un créateur qui
 * enchaîne les lancements. Un clone reste masqué tant qu'il ne dépasse pas
 * le meilleur de sa lignée — un vrai départ finit toujours par sortir du lot.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { bus } from './eventBus.js';
import { tokenStore } from './tokenStore.js';
import { createLogger } from '../util/logger.js';
const log = createLogger('lineage');
const FILE = resolve(process.cwd(), 'data/lineage.json');
const FARM_MIN_LAUNCHES = 3; // à partir du 3e, le ticker est suspect
const CREATOR_FARM_MIN = 3; // idem pour un créateur répétitif
const BEAT_MARGIN = 1.3; // doit faire 30% de mieux que le record
const HARD_PASS_MCAP = 45_000; // au-delà, on affiche quoi qu'il arrive
const HARD_PASS_VOLUME = 25_000;
let state = { tickers: {}, creators: {} };
let dirty = false;
function key(symbol) {
    return symbol.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}
function load() {
    if (!existsSync(FILE))
        return;
    try {
        const parsed = JSON.parse(readFileSync(FILE, 'utf8'));
        if (parsed?.tickers)
            state = { tickers: parsed.tickers, creators: parsed.creators ?? {} };
        log.info(`${Object.keys(state.tickers).length} ticker(s) historisé(s).`);
    }
    catch {
        log.warn('lineage.json illisible — repart de zéro.');
    }
}
function save() {
    if (!dirty)
        return;
    try {
        writeFileSync(FILE, JSON.stringify(state), 'utf8');
        dirty = false;
    }
    catch (err) {
        log.debug('Écriture lineage impossible:', err);
    }
}
function bump(map, k) {
    if (!k)
        return;
    const cur = map[k];
    if (cur) {
        cur.count++;
        cur.lastAt = Date.now();
    }
    else {
        map[k] = { count: 1, bestMcap: 0, lastAt: Date.now() };
    }
    dirty = true;
}
/** Combien de fois ce ticker a déjà été lancé. */
export function tickerLaunches(symbol) {
    return state.tickers[key(symbol)]?.count ?? 0;
}
export function creatorLaunches(creator) {
    return creator ? state.creators[creator]?.count ?? 0 : 0;
}
/**
 * Vrai si le token doit être masqué : clone d'une lignée farmée qui
 * n'a pas encore battu le record de ses prédécesseurs.
 */
export function isFarmClone(t) {
    const k = key(t.symbol);
    const line = state.tickers[k];
    const creator = t.creator ? state.creators[t.creator] : undefined;
    const tickerFarm = (line?.count ?? 0) >= FARM_MIN_LAUNCHES;
    const creatorFarm = (creator?.count ?? 0) >= CREATOR_FARM_MIN;
    if (!tickerFarm && !creatorFarm)
        return false;
    const mcap = t.marketCap ?? 0;
    const vol5m = t.volume.volume5m ?? 0;
    // Sortie de secours : un token qui explose vraiment passe quoi qu'il arrive.
    if (mcap >= HARD_PASS_MCAP || vol5m >= HARD_PASS_VOLUME)
        return false;
    // Sinon il doit battre nettement le meilleur de sa lignée.
    const record = Math.max(line?.bestMcap ?? 0, creator?.bestMcap ?? 0);
    if (record <= 0)
        return false;
    return mcap < record * BEAT_MARGIN;
}
export function startLineageTracker() {
    load();
    const offCreated = bus.on('token:created', (c) => {
        bump(state.tickers, key(c.symbol));
        if (c.creator)
            bump(state.creators, c.creator);
    });
    // Tient à jour le record de chaque lignée
    const timer = setInterval(() => {
        for (const t of tokenStore.all()) {
            const mcap = t.marketCap ?? 0;
            if (mcap <= 0)
                continue;
            const line = state.tickers[key(t.symbol)];
            if (line && mcap > line.bestMcap) {
                line.bestMcap = mcap;
                dirty = true;
            }
            const cr = t.creator ? state.creators[t.creator] : undefined;
            if (cr && mcap > cr.bestMcap) {
                cr.bestMcap = mcap;
                dirty = true;
            }
        }
        save();
    }, 20_000);
    timer.unref();
    log.info('Détection de farm active.');
    return () => {
        clearInterval(timer);
        save();
        offCreated();
    };
}
