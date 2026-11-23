import { store } from '../db/store.js';
import { fingerprintToken, readBotToken } from './botSecrets.js';
import { sendTelegramReply } from './telegramService.js';

const retryMs = 30_000;
let running = false;
let retryAt = 0;
let waitingToRetry = false;
let lastSuccessfulCall = 0;

export function telegramWorkerReady() {
  return Date.now() - lastSuccessfulCall < 15_000;
}

export function wakeTelegramWorker() {
  if (running || Date.now() < retryAt) return;
  running = true;
  setImmediate(async () => {
    try {
      try {
        fingerprintToken('');
      } catch {
        retryAt = Date.now() + retryMs;
        if (!waitingToRetry) console.error('Telegram worker needs a valid BOT_TOKEN_ENCRYPTION_KEY.');
        waitingToRetry = true;
        return;
      }
      for (let index = 0; index < 50; index++) {
        const result = await store.processTelegramUpdate();
        lastSuccessfulCall = Date.now();
        if (waitingToRetry) {
          waitingToRetry = false;
          retryAt = 0;
          console.info('Telegram queue processing recovered.');
        }
        if (!result) break;
        if (result.dead_letter) console.error('Telegram update exhausted retries.', result.update_id);
        if (result.ticket_number) void acknowledge(result);
      }
    } catch (error) {
      lastSuccessfulCall = 0;
      retryAt = Date.now() + retryMs;
      if (!waitingToRetry) {
        const code = error.code;
        let reason = 'Unexpected queue error';
        if (code === 'PGRST202') {
          reason = 'Supabase cannot find process_telegram_update. Check the migration and schema cache';
        } else if (/TimeoutError|timed out|due to timeout/i.test(error.message)) {
          reason = 'Supabase RPC request timed out';
        } else if (/fetch failed|ENOTFOUND|ECONNREFUSED|ECONNRESET|EAI_AGAIN/i.test(error.message)) {
          reason = 'Could not reach the Supabase HTTPS API';
        } else if (/^(?:PGRST[0-9]{3}|[0-9A-Z]{5})$/.test(code || '')) {
          reason = `Supabase returned ${code}`;
        }
        console.error(`Telegram queue paused. ${reason}. Retrying in 30 seconds.`);
      }
      waitingToRetry = true;
    } finally {
      running = false;
    }
  });
}

async function acknowledge(result) {
  try {
    const bot = await store.getBotById(result.bot_id, result.org_id);
    if (!bot || bot.status !== 'active') return;
    await sendTelegramReply(readBotToken(bot), result.chat_id,
      `We received your complaint [${result.ticket_number}]. Our team is reviewing it.`, result.message_id);
  } catch {
    console.warn('Telegram customer acknowledgment failed.', result.ticket_number);
  }
}
