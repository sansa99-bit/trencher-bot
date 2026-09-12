/**
 * Claviers inline. Les liens ne sont générés que si le mint ressemble à une
 * adresse Solana valide : pas de bouton mort dans une alerte.
 */
import { InlineKeyboard } from 'grammy';
import type { TokenState } from '../core/types.js';

export const CALLBACK = {
  watch: 'watch',
  unwatch: 'unwatch',
  ignore: 'ignore',
  refresh: 'refresh',
} as const;

export type CallbackAction = (typeof CALLBACK)[keyof typeof CALLBACK];

const MINT_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export function isPlausibleMint(mint: string): boolean {
  return MINT_RE.test(mint);
}

export function parseCallback(data: string | undefined): { action: CallbackAction; mint: string } | null {
  if (!data) return null;
  const sep = data.indexOf(':');
  if (sep === -1) return null;
  const action = data.slice(0, sep);
  const mint = data.slice(sep + 1);
  if (!mint) return null;
  if (!Object.values(CALLBACK).includes(action as CallbackAction)) return null;
  return { action: action as CallbackAction, mint };
}

export function tokenKeyboard(token: TokenState): InlineKeyboard {
  const kb = new InlineKeyboard();
  const mint = token.mint;

  if (isPlausibleMint(mint)) {
    kb.url('GMGN', `https://gmgn.ai/sol/token/${mint}`)
      .url('Pump.fun', `https://pump.fun/${mint}`)
      .row()
      .url('Dexscreener', `https://dexscreener.com/solana/${mint}`)
      .url('Rugcheck', `https://rugcheck.xyz/tokens/${mint}`)
      .row();
  }

  if (token.watched) kb.text('✅ WATCHED', `${CALLBACK.unwatch}:${mint}`);
  else kb.text('⭐ WATCH', `${CALLBACK.watch}:${mint}`);

  kb.text('🔕 IGNORE', `${CALLBACK.ignore}:${mint}`).row();
  kb.text('🔄 REFRESH', `${CALLBACK.refresh}:${mint}`);

  return kb;
}
