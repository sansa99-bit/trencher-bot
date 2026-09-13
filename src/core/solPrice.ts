import { loadConfig } from '../config/env.js';
import { createLogger } from '../util/logger.js';

const log = createLogger('solprice');

class SolPriceService {
  private price = 150;
  private timer: NodeJS.Timeout | null = null;

  start(): void {
    const config = loadConfig();
    this.price = config.economics.solPriceFallback;
    const refreshMs = config.economics.solPriceRefreshMs;
    if (refreshMs <= 0) {
      log.info(`Rafraîchissement désactivé — prix fixe $${this.price}`);
      return;
    }
    this.fetchPrice();
    this.timer = setInterval(() => this.fetchPrice(), refreshMs);
    this.timer.unref();
  }

  private async fetchPrice(): Promise<void> {
    try {
      const res = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd');
      const data = (await res.json()) as { solana?: { usd?: number } };
      const newPrice = data.solana?.usd;
      if (newPrice && newPrice > 0) {
        this.price = newPrice;
        log.debug(`SOL: $${this.price.toFixed(2)}`);
      }
    } catch (err) {
      log.debug('Erreur fetch prix SOL:', err);
    }
  }

  get(): number {
    return this.price;
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}

export const solPrice = new SolPriceService();
