import { loadConfig } from '../config/env.js';
import { bus } from './eventBus.js';
import { tokenStore } from './tokenStore.js';
import { createLogger } from '../util/logger.js';

const log = createLogger('metadata');

const pending = new Set<string>();
const resolved = new Set<string>();
const queue: string[] = [];
let timer: NodeJS.Timeout | null = null;

export function requestMetadata(mint: string): void {
  if (pending.has(mint) || resolved.has(mint)) return;
  pending.add(mint);
  queue.push(mint);
}

async function fetchOne(mint: string): Promise<void> {
  const config = loadConfig();
  if (!config.helius.rpcUrl) return;
  try {
    const res = await fetch(config.helius.rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'meta',
        method: 'getAsset',
        params: { id: mint },
      }),
    });
    const data = (await res.json()) as any;
    const meta = data?.result?.content?.metadata;
    const symbol = meta?.symbol?.trim();
    const name = meta?.name?.trim();
    const token = tokenStore.get(mint);
    if (token && (symbol || name)) {
      if (symbol) token.symbol = symbol;
      if (name) token.name = name;
      bus.emit('token:updated', token);
    }
  } catch (err) {
    log.debug(`Métadonnées indisponibles pour ${mint.slice(0, 8)}…`);
  } finally {
    pending.delete(mint);
    resolved.add(mint);
    if (resolved.size > 5000) resolved.clear();
  }
}

/** Draine la file lentement pour ne pas saturer le RPC. */
export function startMetadataResolver(): () => void {
  timer = setInterval(() => {
    const batch = queue.splice(0, 5);
    for (const mint of batch) void fetchOne(mint);
  }, 1000);
  timer.unref();
  log.info('Résolution des métadonnées active.');
  return () => {
    if (timer) clearInterval(timer);
    timer = null;
  };
}
