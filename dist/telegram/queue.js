import { createLogger } from '../util/logger.js';
const log = createLogger('queue');
export class SendQueue {
    queue = new Map();
    running = new Set();
    timer = null;
    enqueue(key, fn) {
        this.queue.set(key, { key, fn, retries: 0 });
        this.process();
    }
    process() {
        if (this.timer)
            return;
        this.timer = setInterval(() => this.tick(), 500);
        this.timer.unref();
    }
    tick() {
        for (const [key, task] of this.queue) {
            if (this.running.has(key))
                continue;
            this.running.add(key);
            void this.execute(task);
        }
    }
    async execute(task) {
        try {
            await task.fn();
            this.queue.delete(task.key);
        }
        catch (err) {
            task.retries++;
            if (task.retries > 3) {
                log.error(`Échec ${task.key} après 3 tentatives:`, err);
                this.queue.delete(task.key);
            }
        }
        finally {
            this.running.delete(task.key);
        }
    }
}
export const sendQueue = new SendQueue();
