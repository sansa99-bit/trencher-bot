class Runtime {
    startedAt = Date.now();
    source = null;
    lastSourceEventAt = 0;
    setSource(source) {
        this.source = source;
    }
    getSource() {
        return this.source;
    }
    markSourceEvent(ts = Date.now()) {
        this.lastSourceEventAt = ts;
    }
    get lastEventAt() {
        return this.lastSourceEventAt;
    }
    uptimeMs() {
        return Date.now() - this.startedAt;
    }
}
export const runtime = new Runtime();
