import { EventEmitter } from 'node:events';
class TypedBus {
    emitter = new EventEmitter();
    constructor() {
        this.emitter.setMaxListeners(100);
    }
    on(event, handler) {
        const wrapped = (payload) => {
            try {
                handler(payload);
            }
            catch (err) {
                console.error(`[bus] listener "${String(event)}" a levé une exception:`, err);
            }
        };
        this.emitter.on(event, wrapped);
        return () => {
            this.emitter.off(event, wrapped);
        };
    }
    emit(event, payload) {
        this.emitter.emit(event, payload);
    }
}
export const bus = new TypedBus();
