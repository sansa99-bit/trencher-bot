import { LAMPORTS_PER_SOL, TOKEN_DECIMALS } from '../config/scoring.js';
import { bus } from '../core/eventBus.js';
import { solPrice } from '../core/solPrice.js';
import { createLogger } from '../util/logger.js';
import type { IngestionSource } from '../core/types.js';

const log = createLogger('mock');

const INITIAL_VSOL = 30;
const K = INITIAL_VSOL * 1_000_000_000;
const MIGRATION_SOL = 60;
const WORDS = ['PEPE', 'DOGE', 'MOON', 'SHIB', 'CAT', 'DOG', 'AI', 'AGENT', 'GIGA', 'SOL', 'MOON', 'QUANT'];

interface MockToken {
  mint: string;
  symbol: string;
  name: string;
  creator: string;
  profile: 'rug' | 'slow' | 'runner' | 'survivor';
  solRaised: number;
  migrated: boolean;
  cycle: 'up' | 'down' | 'recovery';
  ticks: number;
  burstTicks: number;
  wallets: string[];
}

export class MockScanner implements IngestionSource {
  readonly name = 'mock';
  private tokens: MockToken[] = [];
  private spawnTimer: NodeJS.Timeout | null = null;
  private tradeTimer: NodeJS.Timeout | null = null;
  private running = false;
  private readonly smartWallets: string[];

  constructor(smartWallets: string[] = []) {
    this.smartWallets = smartWallets;
  }

  isConnected(): boolean {
    return this.running;
  }

  async start(): Promise<void> {
    this.running = true;
    log.warn('SCANNER_MODE=mock — données simulées, aucune donnée on-chain réelle.');
    bus.emit('source:status', { name: this.name, connected: true });
    this.spawn();
    this.spawnTimer = setInterval(() => this.spawn(), 15_000);
    this.tradeTimer = setInterval(() => this.tick(), 500);
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.spawnTimer) clearInterval(this.spawnTimer);
    if (this.tradeTimer) clearInterval(this.tradeTimer);
    this.spawnTimer = null;
    this.tradeTimer = null;
    bus.emit('source:status', { name: this.name, connected: false });
  }

  private spawn(): void {
    if (this.tokens.length > 12) this.tokens.shift();
    const profile = pick<MockToken['profile']>(['rug', 'slow', 'runner', 'survivor']);
    const symbol = `${pick(WORDS)}${randInt(10, 99)}`;
    const token: MockToken = {
      mint: fakeAddress(),
      symbol,
      name: `${symbol} Protocol`,
      creator: fakeAddress(),
      profile,
      solRaised: 0,
      migrated: false,
      cycle: 'up',
      ticks: 0,
      burstTicks: 0,
      wallets: Array.from({ length: 60 }, () => fakeAddress()),
    };
    if (this.smartWallets.length > 0 && (profile === 'runner' || profile === 'survivor')) {
      token.wallets.push(...this.smartWallets);
    }
    this.tokens.push(token);
    bus.emit('token:created', {
      ts: Date.now(),
      mint: token.mint,
      name: token.name,
      symbol: token.symbol,
      creator: token.creator,
    });
  }

  private tick(): void {
    for (const token of this.tokens) {
      token.ticks++;
      if (token.burstTicks > 0) token.burstTicks--;
      else if (token.profile !== 'rug' && Math.random() < 1 / 60) {
        token.burstTicks = randInt(30, 70);
      }
      const trades = this.tradesPerTick(token);
      for (let i = 0; i < trades; i++) this.emitTrade(token);
    }
  }

  private inBurst(token: MockToken): boolean {
    return token.burstTicks > 0;
  }

  private tradesPerTick(token: MockToken): number {
    const multiplier = this.inBurst(token) ? 3 : 1;
    return this.baseTradesPerTick(token) * multiplier;
  }

  private baseTradesPerTick(token: MockToken): number {
    switch (token.profile) {
      case 'rug': return token.ticks < 240 ? randInt(1, 3) : 0;
      case 'slow': return Math.random() < 0.4 ? 1 : 0;
      case 'runner': return randInt(2, 5);
      case 'survivor': return randInt(1, 4);
    }
  }

  private emitTrade(token: MockToken): void {
    const isBuy = this.decideBuy(token);
    const size = this.tradeSize(token, isBuy);
    token.solRaised = Math.max(0, token.solRaised + (isBuy ? size : -size * 0.8));
    const vSol = INITIAL_VSOL + token.solRaised;
    const vTokens = K / vSol;
    const wallet = token.wallets[randInt(0, token.wallets.length - 1)] ?? token.creator;
    bus.emit('token:trade', {
      ts: Date.now(),
      mint: token.mint,
      wallet,
      isBuy,
      solAmount: size,
      tokenAmount: size / (vSol / vTokens),
      usdAmount: size * solPrice.get(),
      virtualSolReserves: Math.round(vSol * LAMPORTS_PER_SOL),
      virtualTokenReserves: Math.round(vTokens * 10 ** TOKEN_DECIMALS),
    });
    if (!token.migrated && token.solRaised >= MIGRATION_SOL) {
      token.migrated = true;
      token.cycle = 'down';
      log.debug(`Mock: $${token.symbol} a migré.`);
    }
    if (token.migrated) {
      if (token.cycle === 'down' && token.solRaised < MIGRATION_SOL * 0.62) {
        token.cycle = 'recovery';
      } else if (token.cycle === 'recovery' && token.solRaised > MIGRATION_SOL * 0.9) {
        token.cycle = 'down';
      }
    }
  }

  private decideBuy(token: MockToken): boolean {
    if (token.profile === 'rug') return Math.random() < (token.ticks < 120 ? 0.8 : 0.12);
    if (this.inBurst(token)) return Math.random() < 0.85;
    if (token.cycle === 'down') return Math.random() < 0.35;
    if (token.cycle === 'recovery') return Math.random() < 0.78;
    if (token.profile === 'runner') return Math.random() < 0.76;
    if (token.profile === 'survivor') return Math.random() < 0.68;
    return Math.random() < 0.5;
  }

  private tradeSize(token: MockToken, isBuy: boolean): number {
    const base = isBuy ? randInt(0.1, 5) : randInt(0.05, 3);
    if (token.profile === 'rug' && !isBuy) return base * 2;
    if (this.inBurst(token)) return base * 1.5;
    return base;
  }
}

function fakeAddress(): string {
  return Array.from({ length: 44 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz0123456789'[Math.floor(Math.random() * 58)]).join('');
}

function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}
