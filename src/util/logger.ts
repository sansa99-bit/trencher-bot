export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 } as const;
const secrets = new Set<string>();

export function registerSecret(value: string | undefined): void {
  if (value) secrets.add(value);
}

export function redact(input: unknown): string {
  let str = String(input);
  for (const secret of secrets) {
    if (secret.length > 8) str = str.replaceAll(secret, `${secret.slice(0, 4)}****`);
  }
  return str;
}

export interface Logger {
  debug(msg: string, err?: unknown): void;
  info(msg: string, err?: unknown): void;
  warn(msg: string, err?: unknown): void;
  error(msg: string, err?: unknown): void;
}

export function createLogger(scope: string): Logger {
  const level = (process.env.LOG_LEVEL ?? 'info') as LogLevel;
  const minLevel = LEVELS[level] ?? 1;

  return {
    debug: (msg, err) => {
      if (LEVELS.debug >= minLevel) console.log(`${now()} DEBUG [${scope}] ${redact(msg)}${err ? '\n' + redact(err) : ''}`);
    },
    info: (msg, err) => {
      if (LEVELS.info >= minLevel) console.log(`${now()} INFO  [${scope}] ${redact(msg)}${err ? '\n' + redact(err) : ''}`);
    },
    warn: (msg, err) => {
      if (LEVELS.warn >= minLevel) console.warn(`${now()} WARN  [${scope}] ${redact(msg)}${err ? '\n' + redact(err) : ''}`);
    },
    error: (msg, err) => {
      if (LEVELS.error >= minLevel) console.error(`${now()} ERROR [${scope}] ${redact(msg)}${err ? '\n' + redact(err) : ''}`);
    },
  };
}

function now(): string {
  const d = new Date();
  return d.toTimeString().slice(0, 8);
}
