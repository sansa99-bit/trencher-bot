const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
const secrets = new Set();
export function registerSecret(value) {
    if (value)
        secrets.add(value);
}
export function redact(input) {
    let str = String(input);
    for (const secret of secrets) {
        if (secret.length > 8)
            str = str.replaceAll(secret, `${secret.slice(0, 4)}****`);
    }
    return str;
}
export function createLogger(scope) {
    const level = (process.env.LOG_LEVEL ?? 'info');
    const minLevel = LEVELS[level] ?? 1;
    return {
        debug: (msg, err) => {
            if (LEVELS.debug >= minLevel)
                console.log(`${now()} DEBUG [${scope}] ${redact(msg)}${err ? '\n' + redact(err) : ''}`);
        },
        info: (msg, err) => {
            if (LEVELS.info >= minLevel)
                console.log(`${now()} INFO  [${scope}] ${redact(msg)}${err ? '\n' + redact(err) : ''}`);
        },
        warn: (msg, err) => {
            if (LEVELS.warn >= minLevel)
                console.warn(`${now()} WARN  [${scope}] ${redact(msg)}${err ? '\n' + redact(err) : ''}`);
        },
        error: (msg, err) => {
            if (LEVELS.error >= minLevel)
                console.error(`${now()} ERROR [${scope}] ${redact(msg)}${err ? '\n' + redact(err) : ''}`);
        },
    };
}
function now() {
    const d = new Date();
    return d.toTimeString().slice(0, 8);
}
