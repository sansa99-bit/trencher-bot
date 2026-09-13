import { loadConfig } from '../config/env.js';
import { createLogger } from '../util/logger.js';
const log = createLogger('holdings');
const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const DAY_MS = 24 * 60 * 60 * 1000;
const cache = new Map();
const CACHE_TTL_MS = 60_000;
async function rpc(method, params) {
    const { helius } = loadConfig();
    if (!helius.rpcUrl)
        throw new Error('RPC indisponible');
    const res = await fetch(helius.rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    });
    const json = (await res.json());
    if (json.error)
        throw new Error(json.error.message ?? 'erreur RPC');
    return json.result;
}
/** Âge du mint via la signature la plus ancienne de son compte. */
async function mintCreatedAt(mint) {
    try {
        const sigs = await rpc('getSignaturesForAddress', [mint, { limit: 1000 }]);
        if (!Array.isArray(sigs) || sigs.length === 0)
            return undefined;
        const oldest = sigs[sigs.length - 1];
        return oldest?.blockTime ? oldest.blockTime * 1000 : undefined;
    }
    catch {
        return undefined;
    }
}
export async function walletHoldings(wallet) {
    const hit = cache.get(wallet);
    if (hit && Date.now() - hit.ts < CACHE_TTL_MS)
        return hit.data;
    const result = await rpc('getTokenAccountsByOwner', [
        wallet,
        { programId: TOKEN_PROGRAM },
        { encoding: 'jsonParsed' },
    ]);
    const raw = [];
    for (const acc of result?.value ?? []) {
        const info = acc?.account?.data?.parsed?.info;
        const amount = Number(info?.tokenAmount?.uiAmount ?? 0);
        if (!info?.mint || amount <= 0)
            continue;
        raw.push({ mint: info.mint, amount, fresh: false });
    }
    // les plus grosses positions d'abord, on ne date que les 25 premières
    raw.sort((a, b) => b.amount - a.amount);
    const head = raw.slice(0, 25);
    const now = Date.now();
    await Promise.all(head.map(async (h) => {
        const created = await mintCreatedAt(h.mint);
        if (created) {
            h.createdAt = created;
            h.fresh = now - created < DAY_MS;
        }
    }));
    // fraîches d'abord, puis par taille
    head.sort((a, b) => {
        if (a.fresh !== b.fresh)
            return a.fresh ? -1 : 1;
        return (b.createdAt ?? 0) - (a.createdAt ?? 0);
    });
    cache.set(wallet, { ts: Date.now(), data: head });
    log.debug(`${wallet.slice(0, 8)}… : ${head.length} positions, ${head.filter(h => h.fresh).length} fraîches`);
    return head;
}
