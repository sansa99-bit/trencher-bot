import type { IngestionSource } from './types.js';

class Runtime {
  readonly startedAt = Date.now();
  private source: IngestionSource | null = null;
  private lastSourceEventAt = 0;

  setSource(source: IngestionSource): void {
    this.source = source;
  }

  getSource(): IngestionSource | null {
    return this.source;
  }

  markSourceEvent(ts = Date.now()): void {
    this.lastSourceEventAt = ts;
  }

  get lastEventAt(): number {
    return this.lastSourceEventAt;
  }

  uptimeMs(): number {
    return Date.now() - this.startedAt;
  }
}

export const runtime = new Runtime();
