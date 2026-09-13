import { LAMPORTS_PER_SOL, PUMPFUN_PROGRAM_ID, TOKEN_DECIMALS } from '../config/scoring.js';
import { loadConfig } from '../config/env.js';
import { bus } from '../core/eventBus.js';
import { solPrice } from '../core/solPrice.js';
import { createLogger } from '../util/logger.js';
import { decodeLogs } from './pumpfunDecoder.js';
const log = createLogger('helius');
export class HeliusScanner {
    name = 'helius';
    ws = null;
    connected = false;
    attempts = 0;
    stopped = false;
    created = 0;
    trades = 0;
    statsTimer = null;
    isConnected() {
        return this.connected;
    }
    async start() {
        const config = loadConfig();
        if (!config.helius.wsUrl) {
            log.error('HELIUS_API_KEY manquante — impossible de démarrer.');
            return;
        }
        this.stopped = false;
        this.statsTimer = setInterval(() => {
            log.info(`Flux: ${this.created} création(s), ${this.trades} trade(s) sur la dernière minute.`);
            this.created = 0;
            this.trades = 0;
        }, 60_000);
        this.statsTimer.unref();
        this.connect(config.helius.wsUrl);
    }
    connect(wsUrl) {
        if (this.stopped)
            return;
        try {
            const ws = new WebSocket(wsUrl);
            this.ws = ws;
            ws.onopen = () => {
                this.connected = true;
                this.attempts = 0;
                log.info('Connecté à Helius.');
                bus.emit('source:status', { name: this.name, connected: true });
                ws.send(JSON.stringify({
                    jsonrpc: '2.0',
                    id: 1,
                    method: 'logsSubscribe',
                    params: [{ mentions: [PUMPFUN_PROGRAM_ID] }, { commitment: 'processed' }],
                }));
            };
            ws.onmessage = (evt) => this.handleMessage(String(evt.data));
            ws.onerror = () => {
                log.warn('Erreur WebSocket Helius.');
            };
            ws.onclose = () => {
                this.connected = false;
                bus.emit('source:status', { name: this.name, connected: false, detail: 'connexion fermée' });
                if (this.stopped)
                    return;
                this.attempts++;
                const delay = Math.min(30_000, 1000 * 2 ** Math.min(this.attempts, 5));
                setTimeout(() => this.connect(wsUrl), delay);
            };
        }
        catch (err) {
            log.error('Erreur création WebSocket:', err);
        }
    }
    handleMessage(data) {
        let msg;
        try {
            msg = JSON.parse(data);
        }
        catch {
            return;
        }
        if (msg.result !== undefined && msg.id === 1) {
            log.info('Abonnement aux logs pump.fun confirmé.');
            return;
        }
        const value = msg?.params?.result?.value;
        const logs = value?.logs;
        if (!Array.isArray(logs) || value?.err)
            return;
        const now = Date.now();
        const price = solPrice.get();
        for (const ev of decodeLogs(logs)) {
            if (ev.type === 'create') {
                this.created++;
                bus.emit('token:created', {
                    ts: now,
                    mint: ev.mint,
                    name: ev.name,
                    symbol: ev.symbol,
                    creator: ev.creator,
                    uri: ev.uri,
                    bondingCurve: ev.bondingCurve,
                });
            }
            else {
                this.trades++;
                const sol = ev.solAmount / LAMPORTS_PER_SOL;
                bus.emit('token:trade', {
                    ts: now,
                    mint: ev.mint,
                    wallet: ev.wallet,
                    isBuy: ev.isBuy,
                    solAmount: sol,
                    tokenAmount: ev.tokenAmount / 10 ** TOKEN_DECIMALS,
                    usdAmount: sol * price,
                    virtualSolReserves: ev.virtualSolReserves,
                    virtualTokenReserves: ev.virtualTokenReserves,
                });
            }
        }
    }
    async stop() {
        this.stopped = true;
        if (this.statsTimer)
            clearInterval(this.statsTimer);
        this.statsTimer = null;
        this.ws?.close();
        this.ws = null;
        this.connected = false;
    }
}
