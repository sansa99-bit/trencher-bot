/**
 * Configuration. Source unique : process.env (+ .env chargé sans dépendance).
 * Aucun secret n'est jamais écrit en dur ni journalisé.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { registerSecret } from '../util/logger.js';

export interface AppConfig {
  telegram: {
    enabled: boolean;
    botToken: string;
    allowedChatIds: number[];
    alertChatIds: number[];
  };
  helius: {
    apiKey: string;
    wsUrl: string;
    rpcUrl: string;
  };
  scanner: {
    mode: 'live' | 'mock';
  };
  alerts: {
    minScore: number;
    cooldownMs: number;
    scoreDelta: number;
    ignoreDurationMs: number;
  };
  economics: {
    solPriceFallback: number;
    solPriceRefreshMs: number;
  };
}

let cached: AppConfig | null = null;

/** Charge .env dans process.env sans écraser les variables déjà définies. */
function loadDotEnv(): void {
  const path = resolve(process.cwd(), '.env');
  if (!existsSync(path)) return;
  for (const raw of readFileSync(path, 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

function str(key: string, fallback = ''): string {
  const v = process.env[key];
  return v !== undefined && v.trim() !== '' ? v.trim() : fallback;
}

function int(key: string, fallback: number): number {
  const n = Number(process.env[key]);
  return Number.isFinite(n) ? n : fallback;
}

function ids(key: string): number[] {
  return str(key)
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n !== 0);
}

export function loadConfig(): AppConfig {
  if (cached) return cached;
  loadDotEnv();

  const botToken = str('TELEGRAM_BOT_TOKEN');
  const apiKey = str('HELIUS_API_KEY');

  // Ces valeurs seront masquées par le logger si elles apparaissent quelque part.
  registerSecret(botToken);
  registerSecret(apiKey);

  const allowedChatIds = ids('TELEGRAM_ALLOWED_CHAT_IDS');
  const alertChatIds = ids('TELEGRAM_ALERT_CHAT_IDS');

  const mode = str('SCANNER_MODE', 'mock') === 'live' ? 'live' : 'mock';

  cached = {
    telegram: {
      enabled: botToken !== '' && str('TELEGRAM_ENABLED', 'true') !== 'false',
      botToken,
      allowedChatIds,
      // Par défaut, on alerte les chats autorisés.
      alertChatIds: alertChatIds.length > 0 ? alertChatIds : allowedChatIds,
    },
    helius: {
      apiKey,
      wsUrl: apiKey ? `wss://mainnet.helius-rpc.com/?api-key=${apiKey}` : '',
      rpcUrl: apiKey ? `https://mainnet.helius-rpc.com/?api-key=${apiKey}` : '',
    },
    scanner: { mode },
    alerts: {
      minScore: int('ALERT_MIN_SCORE', 75),
      cooldownMs: int('ALERT_COOLDOWN_MS', 180_000),
      scoreDelta: int('ALERT_SCORE_DELTA', 5),
      ignoreDurationMs: int('ALERT_IGNORE_DURATION_MS', 3_600_000),
    },
    economics: {
      solPriceFallback: int('SOL_PRICE_FALLBACK', 150),
      solPriceRefreshMs: int('SOL_PRICE_REFRESH_MS', 60_000),
    },
  };

  if (mode === 'live' && apiKey === '') {
    throw new Error('SCANNER_MODE=live requiert HELIUS_API_KEY (voir .env.example).');
  }

  return cached;
}

/** Tests uniquement. */
export function resetConfig(): void {
  cached = null;
}
