import { Bot, GrammyError, HttpError } from 'grammy';
import type { Context } from 'grammy';
import { loadConfig } from '../config/env.js';
import { createLogger } from '../util/logger.js';
import { sendQueue } from './queue.js';

const log = createLogger('telegram');

export interface TelegramStatus {
  enabled: boolean;
  online: boolean;
  username?: string;
  lastError?: string;
  sent: number;
  failed: number;
}

class TelegramService {
  private bot: Bot | null = null;
  private online = false;
  private username: string | undefined;
  private lastError: string | undefined;
  private sent = 0;
  private failed = 0;

  get instance(): Bot | null {
    return this.bot;
  }

  status(): TelegramStatus {
    const config = loadConfig();
    return { enabled: config.telegram.enabled, online: this.online, username: this.username, lastError: this.lastError, sent: this.sent, failed: this.failed };
  }

  isAuthorized(chatId: number | undefined): boolean {
    if (chatId === undefined) return false;
    const allowed = loadConfig().telegram.allowedChatIds;
    return allowed.includes(chatId);
  }

  alertChatIds(): number[] {
    return loadConfig().telegram.alertChatIds;
  }

  create(): Bot | null {
    const config = loadConfig();
    if (!config.telegram.enabled) {
      log.warn('Telegram désactivé — les alertes seront affichées en console.');
      return null;
    }
    const bot = new Bot(config.telegram.botToken);
    bot.catch((err) => {
      this.failed++;
      const e = err.error;
      if (e instanceof GrammyError) {
        this.lastError = `API ${e.error_code}: ${e.description}`;
        log.error('Erreur API Telegram:', this.lastError);
      } else if (e instanceof HttpError) {
        this.lastError = 'réseau indisponible';
        log.error('Erreur réseau Telegram:', e);
      }
    });
    bot.use(async (ctx, next) => {
      const chatId = ctx.chat?.id;
      if (!this.isAuthorized(chatId)) {
        log.warn(`Accès refusé — chat ID ${chatId ?? 'inconnu'}`);
        await safeReply(ctx, `⛔ Accès refusé.\nVotre chat ID : <code>${chatId}</code>`);
        return;
      }
      await next();
    });
    this.bot = bot;
    return bot;
  }

  async launch(): Promise<void> {
    if (!this.bot) return;
    try {
      const me = await this.bot.api.getMe();
      this.username = me.username;
      log.info(`Bot @${me.username} authentifié.`);
    } catch (err) {
      this.online = false;
      this.lastError = 'authentification échouée';
      log.error('Impossible de joindre l\'API Telegram.', err);
      return;
    }
    void this.bot.start({ drop_pending_updates: true, onStart: () => { this.online = true; log.info('Long polling démarré.'); } });
  }

  async stop(): Promise<void> {
    this.online = false;
    try {
      await this.bot?.stop();
    } catch (err) {
      log.debug('Arrêt du bot:', err);
    }
  }

  safeSendMessage(chatId: number, text: string, extra: Record<string, unknown> = {}): void {
    if (!this.bot || !this.online) {
      log.debug(`Telegram hors ligne — message non envoyé au chat ${chatId}.`);
      return;
    }
    const bot = this.bot;
    sendQueue.enqueue(`chat:${chatId}`, async () => {
      await bot.api.sendMessage(chatId, text, { parse_mode: 'HTML', link_preview_options: { is_disabled: true }, ...extra });
      this.sent++;
    });
  }

  broadcast(text: string, extra: Record<string, unknown> = {}): void {
    const targets = this.alertChatIds();
    if (targets.length === 0) {
      log.warn('Aucun chat destinataire configuré.');
      return;
    }
    for (const chatId of targets) this.safeSendMessage(chatId, text, extra);
  }
}

export async function safeReply(ctx: Context, text: string, extra: Record<string, unknown> = {}): Promise<void> {
  try {
    await ctx.reply(text, { parse_mode: 'HTML', link_preview_options: { is_disabled: true }, ...extra });
  } catch (err) {
    log.error('Réponse impossible:', err);
  }
}

export const telegram = new TelegramService();
