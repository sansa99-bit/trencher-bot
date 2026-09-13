import { createLogger } from '../util/logger.js';

const log = createLogger('queue');

interface Task {
  key: string;
  fn: () => Promise<void>;
  retries: number;
}

export class SendQueue {
  private readonly queue = new Map<string, Task>();
  private readonly running = new Set<string>();
  private timer: NodeJS.Timeout | null = null;

  enqueue(key: string, fn: () => Promise<void>): void {
    this.queue.set(key, { key, fn, retries: 0 });
    this.process();
  }

  private process(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), 500);
    this.timer.unref();
  }

  private tick(): void {
    for (const [key, task] of this.queue) {
      if (this.running.has(key)) continue;
      this.running.add(key);
      void this.execute(task);
    }
  }

  private async execute(task: Task): Promise<void> {
    try {
      await task.fn();
      this.queue.delete(task.key);
    } catch (err) {
      task.retries++;
      if (task.retries > 3) {
        log.error(`Échec ${task.key} après 3 tentatives:`, err);
        this.queue.delete(task.key);
      }
    } finally {
      this.running.delete(task.key);
    }
  }
}

export const sendQueue = new SendQueue();
