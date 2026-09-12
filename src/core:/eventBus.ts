/**
 * Bus d'événements typé. Découple ingestion / pipeline / Telegram.
 * `on()` renvoie une fonction de désabonnement.
 * Une exception dans un listener est journalisée, jamais propagée.
 */
import { EventEmitter } from 'node:events';
import type { AlertEvent, SourceStatus, TokenCreation, TokenState, Trade } from './types.js';

interface EventMap {
  'token:created': TokenCreation;
  'token:trade': Trade;
  'token:updated': TokenState;
  'token:migrated': TokenState;
  'alert:emit': AlertEvent;
  'source:status': SourceStatus;
}

class TypedBus {
  private readonly emitter = new EventEmitter();

  constructor() {
    this.emitter.setMaxListeners(100);
  }

  on<K extends keyof EventMap>(event: K, handler: (payload: EventMap[K]) => void): () => void {
    const wrapped = (payload: EventMap[K]): void => {
      try {
        handler(payload);
      } catch (err) {
        console.error(`[bus] listener "${String(event)}" a levé une exception:`, err);
      }
    };
    this.emitter.on(event, wrapped as (...args: unknown[]) => void);
    return () => {
      this.emitter.off(event, wrapped as (...args: unknown[]) => void);
    };
  }

  emit<K extends keyof EventMap>(event: K, payload: EventMap[K]): void {
    this.emitter.emit(event, payload);
  }
}

export const bus = new TypedBus();
