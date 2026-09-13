import { createLogger } from '../util/logger.js';
const log = createLogger('majors');
const IDS = 'bitcoin,ethereum,solana,binancecoin,ripple';
const LABELS = {
    bitcoin: 'BTC',
    ethereum: 'ETH',
    solana: 'SOL',
    binancecoin: 'BNB',
    ripple: 'XRP',
};
let cache = [];
async function refresh() {
    try {
        const url = `https://api.coingecko.com/api/v3/simple/price?ids=${IDS}&vs_currencies=usd&include_24hr_change=true`;
        const res = await fetch(url, { headers: { Accept: 'application/json' } });
        if (!res.ok)
            throw new Error(`HTTP ${res.status}`);
        const data = (await res.json());
        const out = [];
        for (const [id, label] of Object.entries(LABELS)) {
            const row = data[id];
            if (row?.usd)
                out.push({ symbol: label, price: row.usd, change24h: row.usd_24h_change });
        }
        if (out.length > 0)
            cache = out;
    }
    catch (err) {
        log.debug('Majors indisponibles:', err);
    }
}
export function startMajors() {
    void refresh();
    const timer = setInterval(() => void refresh(), 45_000);
    timer.unref();
    log.info('Suivi des majors actif.');
    return () => clearInterval(timer);
}
export function majors() {
    return cache;
}
