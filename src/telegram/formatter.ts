/**
 * Rendu Telegram (parse_mode HTML).
 * Aucune métrique manquante ne casse le rendu : la ligne est masquée.
 */
import { drawdown, levelLabel } from '../core/scorer.js';
import { age, escapeHtml, lines, num, pct, ratio, signedPct, usd } from '../util/format.js';
import type { ProfitUpdate } from '../core/types.js';
import type { AlertEvent, ScoreBreakdown, TokenState } from '../core/types.js';

function ticker(token: TokenState): string {
  return escapeHtml(token.symbol ? `$${token.symbol}` : token.mint.slice(0, 6));
}

function breakdownLines(breakdown: ScoreBreakdown | undefined): string {
  if (!breakdown) return '';
  return breakdown.parts.map((p) => `${p.label}: ${p.value}/${p.max}`).join('\n');
}

function volumeBlock(token: TokenState): string {
  const v = token.volume;
  return lines([
    ['Volume 15s', usd(v.volume15s)],
    ['Volume 1m', usd(v.volume1m)],
    ['Volume 3m', usd(v.volume3m)],
    ['Volume 5m', usd(v.volume5m)],
  ]).join('\n');
}

function flowBlock(token: TokenState): string {
  const v = token.volume;
  return lines([
    ['Buy Volume', usd(v.buyVolume)],
    ['Sell Volume', usd(v.sellVolume)],
    ['Buy/Sell', ratio(v.buySellRatio)],
    ['Unique Buyers 1m', num(v.uniqueBuyers1m ?? v.uniqueBuyers)],
    ['Largest Buy', usd(v.largestBuy)],
  ]).join('\n');
}

function contractBlock(token: TokenState): string {
  return `CA:\n<code>${escapeHtml(token.mint)}</code>`;
}

function join(blocks: Array<string | undefined>): string {
  return blocks.filter((b) => b !== undefined && b !== '').join('\n\n');
}

export function formatEarly(event: AlertEvent): string {
  const t = event.token;
  const header = `🚨 <b>EARLY ${levelLabel(event.level)}</b> — ${ticker(t)}`;

  const facts = lines([
    ['MC', usd(t.marketCap)],
    ['Age', age(Date.now() - t.createdAt)],
    ['Bonding Curve', pct(t.bondingCurveProgress)],
  ]).join('\n');

  const curve = lines([
    ['Curve Δ 1m', signedPct(t.bondingCurveDelta1m)],
  ]).join('\n');

  return join([
    header,
    facts,
    `⭐ <b>SCORE: ${event.score}/100</b>`,
    breakdownLines(event.breakdown),
    volumeBlock(t),
    flowBlock(t),
    curve,
    `🟢 <b>${levelLabel(event.level)} EARLY</b>`,
    contractBlock(t),
  ]);
}

export function formatPostMigration(event: AlertEvent): string {
  const t = event.token;
  const dd = drawdown(t);

  const facts = lines([
    ['Migration MC', usd(t.migrationMarketCap)],
    ['Current MC', usd(t.marketCap)],
    ['ATH', usd(t.athMarketCap)],
    ['Drawdown ATH', signedPct(dd)],
  ]).join('\n');

  const flow = lines([
    ['Volume 1m', usd(t.volume.volume1m)],
    ['Volume 5m', usd(t.volume.volume5m)],
    ['Buy/Sell', ratio(t.volume.buySellRatio)],
    ['Holders Δ', signedPct(t.holdersDelta)],
    ['Unique Buyers Δ', signedPct(t.uniqueBuyersDelta)],
  ]).join('\n');

  const smart = t.smartWallets
    ? `Smart wallets holding:\n${t.smartWallets.holding} / ${t.smartWallets.tracked}`
    : undefined;

  return join([
    `🚀 <b>POST-MIGRATION</b> — ${ticker(t)}`,
    `⭐ <b>SURVIVOR SCORE: ${event.score}/100</b>`,
    facts,
    breakdownLines(event.breakdown),
    flow,
    smart,
    '🟢 <b>POST-MIGRATION SETUP</b>',
    contractBlock(t),
  ]);
}

export function formatReentry(event: AlertEvent): string {
  const t = event.token;
  const dd = drawdown(t);

  const facts = lines([
    ['ATH', usd(t.athMarketCap)],
    ['Current MC', usd(t.marketCap)],
    ['Drawdown', signedPct(dd)],
  ]).join('\n');

  const flow = lines([
    ['Volume 5m', usd(t.volume.volume5m)],
    ['Volume Accel', t.volume.volumeAcceleration !== undefined ? `x${t.volume.volumeAcceleration.toFixed(2)}` : 'N/A'],
    ['Holders', signedPct(t.holdersDelta)],
    ['Unique Buyers', signedPct(t.uniqueBuyersDelta)],
    ['Buy/Sell', ratio(t.volume.buySellRatio)],
  ]).join('\n');

  const smart = t.smartWallets
    ? `Smart Wallets:\n${t.smartWallets.entered} entered\n${t.smartWallets.holding} holding`
    : undefined;

  const narrative = t.narrative ? `Narrative: ${t.narrative}` : undefined;

  return join([
    `♻️ <b>RE-ENTRY</b> — ${ticker(t)}`,
    facts,
    `⭐ <b>RE-ENTRY SCORE: ${event.score}/100</b>`,
    breakdownLines(event.breakdown),
    flow,
    smart,
    narrative,
    '🟢 <b>RE-ENTRY DETECTED</b>',
    contractBlock(t),
  ]);
}

/** Aiguillage unique utilisé par le pont d'alertes. */
export function formatAlert(event: AlertEvent): string {
  switch (event.kind) {
    case 'POST_MIGRATION':
      return formatPostMigration(event);
    case 'RE_ENTRY':
      return formatReentry(event);
    default:
      return formatEarly(event);
  }
}

/** Vue détaillée /token &lt;CA&gt;. */
export function formatTokenDetail(token: TokenState): string {
  const v = token.volume;
  const dd = drawdown(token);

  const head = lines([
    ['Phase', token.phase === 'MIGRATED' ? 'POST-MIGRATION' : 'PRE-MIGRATION'],
    ['Age', age(Date.now() - token.createdAt)],
    ['MC', usd(token.marketCap)],
    ['ATH', usd(token.athMarketCap)],
    ['Drawdown', signedPct(dd)],
    ['Bonding Curve', pct(token.bondingCurveProgress)],
    ['Liquidity', usd(token.liquidityUsd)],
    ['Holders', num(token.holders)],
  ]).join('\n');

  const scores = lines([
    ['⭐ Score', token.score !== undefined ? `${token.score}/100` : 'N/A'],
    ['♻️ Re-entry', token.reentryScore !== undefined ? `${token.reentryScore}/100` : 'N/A'],
  ]).join('\n');

  const volume = lines([
    ['15s', usd(v.volume15s)],
    ['30s', usd(v.volume30s)],
    ['1m', usd(v.volume1m)],
    ['3m', usd(v.volume3m)],
    ['5m', usd(v.volume5m)],
    ['Buy', usd(v.buyVolume)],
    ['Sell', usd(v.sellVolume)],
    ['Buy/Sell', ratio(v.buySellRatio)],
    ['Acceleration', v.volumeAcceleration !== undefined ? `x${v.volumeAcceleration.toFixed(2)}` : 'N/A'],
    ['Unique Buyers', num(v.uniqueBuyers)],
    ['Unique Sellers', num(v.uniqueSellers)],
    ['Avg Buy', usd(v.averageBuySize)],
    ['Median Buy', usd(v.medianBuySize)],
    ['Largest Buy', usd(v.largestBuy)],
    ['Trades 1m', num(v.tradeCount1m)],
  ]).join('\n');

  const flags = [
    token.watched ? '⭐ Dans la watchlist' : '',
    token.ignoredUntil !== undefined ? '🔕 Ignoré' : '',
  ]
    .filter(Boolean)
    .join('\n');

  return join([
    `🔎 <b>${ticker(token)}</b> — ${escapeHtml(token.name)}`,
    head,
    scores,
    `<b>VOLUME</b>\n${volume}`,
    breakdownLines(token.scoreBreakdown),
    flags,
    contractBlock(token),
  ]);
}

/** Ligne compacte pour /early, /migrated, /reentry, /watchlist. */
export function formatTokenLine(token: TokenState, rank: number): string {
  const score = token.reentryScore ?? token.score;
  const head = [
    `${rank}. <b>${ticker(token)}</b>`,
    score !== undefined ? `⭐${score}` : undefined,
    usd(token.marketCap) !== 'N/A' ? usd(token.marketCap) : undefined,
    token.volume.volume5m !== undefined ? `V5m ${usd(token.volume.volume5m)}` : undefined,
  ]
    .filter(Boolean)
    .join(' · ');

  return `${head}\n<code>${escapeHtml(token.mint)}</code>`;
}

export function formatProfitUpdate(update: ProfitUpdate): string {
  if (update.status === 'stopped') {
    return `🛑 <b>$${update.symbol}</b> arrêté du suivi (${update.reason})`;
  }
  const mult = update.multiplier?.toFixed(1) ?? '?';
  const elapsed = update.elapsed ? age(update.elapsed) : '?';
  const lines = [
    `💰 <b>$${update.symbol} ${mult}X PROFIT</b>`,
    `CA: ${usd(update.mcapStart)} → ${usd(update.mcapCurrent)}`,
    `Temps: ${elapsed}`,
  ];
  return lines.join('\n');
}
