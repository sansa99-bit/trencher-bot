import type { Bot, CommandContext, Context } from 'grammy';
import { loadConfig } from '../config/env.js';
import { runtime } from '../core/runtime.js';
import { solPrice } from '../core/solPrice.js';
import { tokenStore } from '../core/tokenStore.js';
import { age, escapeHtml } from '../util/format.js';
import { createLogger } from '../util/logger.js';
import { safeReply, telegram } from './bot.js';
import { formatTokenDetail, formatTokenLine } from './formatter.js';
import { CALLBACK, parseCallback, tokenKeyboard } from './keyboards.js';
import { sendTestAlert } from './alerts.js';

const log = createLogger('commands');
const LIST_LIMIT = 5;

export function registerCommands(bot: Bot): void {
  bot.command('start', async (ctx) => {
    const source = runtime.getSource();
    const tg = telegram.status();
    const text = [
      '🤖 <b>TRENCHER BOT ONLINE</b>',
      '',
      `Solana Scanner: ${source?.isConnected() ? '🟢' : '🔴'}`,
      `Telegram: ${tg.online ? '🟢' : '🟡'}`,
      '',
      'Commands:',
      '/early',
      '/migrated',
      '/reentry',
      '/watchlist',
      '/status',
      '/test',
    ].join('\n');
    await safeReply(ctx, text);
  });

  bot.command('status', async (ctx) => {
    const source = runtime.getSource();
    const stats = tokenStore.stats();
    const tg = telegram.status();
    const config = loadConfig();
    const lastEvent = runtime.lastEventAt > 0 ? age(Date.now() - runtime.lastEventAt) : 'jamais';
    const text = [
      '📊 <b>STATUS</b>',
      '',
      `Scanner: ${source?.isConnected() ? '🟢 actif' : '🔴 déconnecté'} (${config.scanner.mode})`,
      `Tokens suivis: ${stats.total}`,
      `Pre-migration: ${stats.preMigration}`,
      `Post-migration: ${stats.migrated}`,
      `Watchlist: ${stats.watched}`,
      `Trades en mémoire: ${stats.trades}`,
      '',
      `Dernier événement: ${lastEvent}`,
      `Prix SOL: $${solPrice.get().toFixed(2)}`,
      `Messages envoyés: ${tg.sent} (échecs: ${tg.failed})`,
      '',
      `Uptime: ${age(runtime.uptimeMs())}`,
    ].filter(Boolean).join('\n');
    await safeReply(ctx, text);
  });

  bot.command('early', async (ctx) => {
    const tokens = tokenStore.top(LIST_LIMIT, 'PRE_MIGRATION');
    await sendList(ctx, '🔎 <b>TOP PRE-MIGRATION</b>', tokens);
  });

  bot.command('migrated', async (ctx) => {
    const tokens = tokenStore.top(LIST_LIMIT, 'MIGRATED');
    await sendList(ctx, '🚀 <b>TOP POST-MIGRATION</b>', tokens);
  });

  bot.command('reentry', async (ctx) => {
    const tokens = tokenStore.topReentry(LIST_LIMIT);
    await sendList(ctx, '♻️ <b>TOP RE-ENTRY</b>', tokens);
  });

  bot.command('watchlist', async (ctx) => {
    const tokens = tokenStore.watchlist();
    await sendList(ctx, '⭐ <b>WATCHLIST</b>', tokens);
  });

  bot.command('token', async (ctx) => {
    const arg = (ctx.match ?? '').toString().trim();
    if (!arg) {
      await safeReply(ctx, 'Usage : <code>/token &lt;CONTRACT_ADDRESS&gt;</code>');
      return;
    }
    const token = tokenStore.get(arg);
    if (!token) {
      await safeReply(ctx, `Aucune donnée pour <code>${escapeHtml(arg)}</code>.`);
      return;
    }
    await safeReply(ctx, formatTokenDetail(token), { reply_markup: tokenKeyboard(token) });
  });

  bot.command('test', async (ctx) => {
    sendTestAlert();
    await safeReply(ctx, '✅ Alerte de test envoyée.');
  });

  registerCallbacks(bot);
  log.info('Commandes enregistrées.');
}

async function sendList(ctx: CommandContext<Context>, title: string, tokens: ReturnType<typeof tokenStore.all>): Promise<void> {
  if (tokens.length === 0) {
    await safeReply(ctx, `${title}\n\nAucun token pour l'instant.`);
    return;
  }
  const body = tokens.map((t, i) => formatTokenLine(t, i + 1)).join('\n\n');
  await safeReply(ctx, `${title}\n\n${body}`);
}

function registerCallbacks(bot: Bot): void {
  bot.on('callback_query:data', async (ctx) => {
    const parsed = parseCallback(ctx.callbackQuery.data);
    if (!parsed) {
      await ctx.answerCallbackQuery({ text: 'Action inconnue.' }).catch(() => undefined);
      return;
    }
    const { action, mint } = parsed;
    const token = tokenStore.get(mint);
    if (!token) {
      await ctx.answerCallbackQuery({ text: 'Token non suivi.' }).catch(() => undefined);
      return;
    }
    try {
      switch (action) {
        case CALLBACK.watch:
          tokenStore.setWatched(mint, true);
          await ctx.answerCallbackQuery({ text: `⭐ $${token.symbol} ajouté à la watchlist.` });
          break;
        case CALLBACK.unwatch:
          tokenStore.setWatched(mint, false);
          await ctx.answerCallbackQuery({ text: `$${token.symbol} retiré de la watchlist.` });
          break;
        case CALLBACK.ignore:
          const duration = loadConfig().alerts.ignoreDurationMs;
          tokenStore.setIgnored(mint, duration);
          const label = duration <= 0 ? 'définitivement' : `pendant ${age(duration)}`;
          await ctx.answerCallbackQuery({ text: `🔕 $${token.symbol} ignoré ${label}.` });
          break;
        case CALLBACK.refresh:
          await ctx.answerCallbackQuery({ text: 'Actualisation…' });
          await safeReply(ctx, formatTokenDetail(token), { reply_markup: tokenKeyboard(token) });
          return;
        default:
          await ctx.answerCallbackQuery({ text: 'Action inconnue.' });
          return;
      }
      await ctx.editMessageReplyMarkup({ reply_markup: tokenKeyboard(token) });
    } catch (err) {
      log.debug('Callback non appliqué:', err);
    }
  });
}
