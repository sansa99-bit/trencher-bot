export const NA = 'N/A';

function isNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

export function usd(value: number | undefined | null): string {
  if (!isNum(value)) return NA;
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(2)}B`;
  if (abs >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  if (abs >= 1) return `$${value.toFixed(0)}`;
  return `$${value.toFixed(4)}`;
}

export function num(value: number | undefined | null, digits = 0): string {
  if (!isNum(value)) return NA;
  return value.toFixed(digits);
}

export function ratio(value: number | undefined | null): string {
  if (!isNum(value)) return NA;
  return value.toFixed(2);
}

export function pct(value: number | undefined | null, digits = 0): string {
  if (!isNum(value)) return NA;
  return `${(value * 100).toFixed(digits)}%`;
}

export function signedPct(value: number | undefined | null, digits = 0): string {
  if (!isNum(value)) return NA;
  const sign = value > 0 ? '+' : '';
  return `${sign}${(value * 100).toFixed(digits)}%`;
}

export function age(ms: number | undefined | null): string {
  if (!isNum(ms) || ms < 0) return NA;
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}h ${m % 60}m`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

export function shortAddress(address: string | undefined, edge = 4): string {
  if (!address || address.length < edge * 2) return address ?? NA;
  return `${address.slice(0, edge)}…${address.slice(-edge)}`;
}

export function escapeHtml(input: string): string {
  return input.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function lines(entries: Array<[label: string, value: string]>): string[] {
  return entries.filter(([, value]) => value !== NA).map(([label, value]) => (label ? `${label}: ${value}` : value));
}
