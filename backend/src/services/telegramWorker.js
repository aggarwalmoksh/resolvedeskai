import { store } from '../db/store.js';
import { fingerprintToken, readBotToken } from './botSecrets.js';
import { sendTelegramReply } from './telegramService.js';

const schemaRetryMs = 30_000;
let running = false;
let schemaRetryAt = 0;
let waitingForSchema = false;
let lastSuccessfulCall = 0;

export function telegramWorkerReady() {
  return Date.now() - lastSuccessfulCall < 15_000;
}

export function wakeTelegramWorker() {
  if (running || Date.now() < schemaRetryAt) return;
  running = true;
  setImmediate(async () => {
    try {
      try {
        fingerprintToken('');
      } catch {
        schemaRetryAt = Date.now() + schemaRetryMs;
        if (!waitingForSchema) console.error('Telegram worker needs a valid BOT_TOKEN_ENCRYPTION_KEY.');
        waitingForSchema = true;
        return;
      }
      for (let index = 0; index < 50; index++) {
        const result = await store.processTelegramUpdate();
        lastSuccessfulCall = Date.now();
        if (waitingForSchema) {
          waitingForSchema = false;
          schemaRetryAt = 0;
          console.info('Telegram queue database function is available.');
        }
        if (!result) break;
        if (result.dead_letter) console.error('Telegram update exhausted retries.', result.update_id);
        if (result.ticket_number) void acknowledge(result);
      }
    } catch (error) {
      lastSuccessfulCall = 0;
      if (error.code === 'PGRST202') {
        schemaRetryAt = Date.now() + schemaRetryMs;
        if (!waitingForSchema) {
          console.error('Telegram queue paused (PGRST202). Apply backend/src/db/migrations/harden_tenant_and_telegram.sql in Supabase. If already applied, reload the PostgREST schema cache. The worker will retry in 30 seconds.');
        }
        waitingForSchema = true;
      } else {
        console.error('Telegram queue processing failed.', error.code || error.name);
      }
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
