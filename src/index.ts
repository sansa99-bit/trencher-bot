import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadConfig } from './config/env.js';
import { startPipeline } from './core/pipeline.js';
import { runtime } from './core/runtime.js';
import { solPrice } from './core/solPrice.js';
import { tokenStore } from './core/tokenStore.js';
import { HeliusScanner } from './sources/heliusScanner.js';
import { MockScanner } from './sources/mockScanner.js';
import { startAlertBridge } from './telegram/alerts.js';
import { telegram } from './telegram/bot.js';
import { registerCommands } from './telegram/commands.js';
import { createLogger } from './util/logger.js';
import { startApi } from './api/server.js';
import { startDexEnricher } from './core/dexscreener.js';
import { startOutcomeTracker } from './core/outcomes.js';
import { startLineageTracker } from './core/lineage.js';
import { startSampler } from './core/samples.js';
import type { IngestionSource } from './core/types.js';

const log = createLogger('main');

async function main(): Promise<void> {
  const config = loadConfig();

  log.info('──────────────────────────────────────');
  log.info('  TRENCHER BOT');
  log.info(`  mode: ${config.scanner.mode}`);
  log.info(`  telegram: ${config.telegram.enabled ? 'activé' : 'désactivé'}`);
  log.info('──────────────────────────────────────');

  loadSmartWallets();
  solPrice.start();

  const stopPipeline = startPipeline();
  const stopBridge = startAlertBridge();
  const stopApi = startApi();
  const stopDex = startDexEnricher();
  const stopOutcomes = startOutcomeTracker();
  const stopLineage = startLineageTracker();
  const stopSampler = startSampler();

  try {
    const bot = telegram.create();
    if (bot) {
      registerCommands(bot);
      await telegram.launch();
    }
  } catch (err) {
    log.error('Initialisation Telegram échouée — le scanner continue.', err);
  }

  const source: IngestionSource =
    config.scanner.mode === 'live'
      ? new HeliusScanner()
      : new MockScanner([...tokenStore.smartWalletSet]);

  runtime.setSource(source);
  await source.start();

  log.info('Système opérationnel. Envoyez /start dans Telegram.');

  setupShutdown(async () => {
    log.info('Arrêt en cours…');
    await source.stop();
    stopSampler();
    stopLineage();
    stopOutcomes();
    stopDex();
    stopApi();
    stopBridge();
    stopPipeline();
    solPrice.stop();
    await telegram.stop();
    log.info('Arrêt terminé.');
  });
}

function loadSmartWallets(): void {
  const path = resolve(process.cwd(), 'config/smart-wallets.json');
  if (!existsSync(path)) {
    log.info('Aucune liste de smart wallets — composante notée en neutre.');
    return;
  }
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
    if (!Array.isArray(parsed)) throw new Error('le fichier doit contenir un tableau');
    const wallets = parsed.filter((w): w is string => typeof w === 'string');
    tokenStore.setSmartWallets(wallets);
    log.info(`${wallets.length} smart wallet(s) chargé(s).`);
  } catch (err) {
    log.warn('smart-wallets.json illisible — ignoré:', err);
  }
}

function setupShutdown(cleanup: () => Promise<void>): void {
  let shuttingDown = false;
  const handler = (signal: string) => {
    void (async () => {
      if (shuttingDown) return;
      shuttingDown = true;
      log.info(`Signal ${signal} reçu.`);
      try {
        await cleanup();
      } catch (err) {
        log.error('Erreur pendant l\'arrêt:', err);
      }
      process.exit(0);
    })();
  };

  process.on('SIGINT', () => handler('SIGINT'));
  process.on('SIGTERM', () => handler('SIGTERM'));

  process.on('unhandledRejection', (reason) => {
    log.error('Promesse rejetée non gérée:', reason);
  });
  process.on('uncaughtException', (err) => {
    log.error('Exception non capturée:', err);
  });
}

void main().catch((err) => {
  log.error('Échec fatal au démarrage:', err);
  process.exit(1);
});
