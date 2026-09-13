import { Bot, GrammyError, HttpError } from 'grammy';
import { loadConfig } from '../config/env.js';
import { createLogger } from '../util/logger.js';
import { sendQueue } from './queue.js';
const log = createLogger('telegram');
class TelegramService {
    bot = null;
    online = false;
    username;
    lastError;
    sent = 0;
    failed = 0;
    get instance() {
        return this.bot;
    }
    status() {
        const config = loadConfig();
        return { enabled: config.telegram.enabled, online: this.online, username: this.username, lastError: this.lastError, sent: this.sent, failed: this.failed };
    }
    isAuthorized(chatId) {
        if (chatId === undefined)
            return false;
        const allowed = loadConfig().telegram.allowedChatIds;
        return allowed.includes(chatId);
    }
    alertChatIds() {
        return loadConfig().telegram.alertChatIds;
    }
    create() {
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
            }
            else if (e instanceof HttpError) {
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
    async launch() {
        if (!this.bot)
            return;
        try {
            const me = await this.bot.api.getMe();
            this.username = me.username;
            log.info(`Bot @${me.username} authentifié.`);
        }
        catch (err) {
            this.online = false;
            this.lastError = 'authentification échouée';
            log.error('Impossible de joindre l\'API Telegram.', err);
            return;
        }
        void this.bot.start({ drop_pending_updates: true, onStart: () => { this.online = true; log.info('Long polling démarré.'); } });
    }
    async stop() {
        this.online = false;
        try {
            await this.bot?.stop();
        }
        catch (err) {
            log.debug('Arrêt du bot:', err);
        }
    }
    safeSendMessage(chatId, text, extra = {}) {
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
    broadcast(text, extra = {}) {
        const targets = this.alertChatIds();
        if (targets.length === 0) {
            log.warn('Aucun chat destinataire configuré.');
            return;
        }
        for (const chatId of targets)
            this.safeSendMessage(chatId, text, extra);
    }
}
export async function safeReply(ctx, text, extra = {}) {
    try {
        await ctx.reply(text, { parse_mode: 'HTML', link_preview_options: { is_disabled: true }, ...extra });
    }
    catch (err) {
        log.error('Réponse impossible:', err);
    }
}
export const telegram = new TelegramService();
