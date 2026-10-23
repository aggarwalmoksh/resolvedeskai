import express from 'express';
import { store } from '../db/store.js';
import { ingestTelegramMessage } from '../services/complaintService.js';
import { ENFORCE_SECRET_TOKEN, BOT_TOKEN, SECRET_TOKEN, PUBLIC_BASE_URL } from '../config.js';

const router = express.Router();

/**
 * Health check for webhook paths
 * GET /telegram/webhook
 */
router.get('/webhook', (req, res) => {
  res.json({
    status: 'ok',
    message: 'Telegram webhook receiver is active and listening for POST updates.',
    mode: 'default'
  });
});

/**
 * GET /telegram/webhook/:botId
 */
router.get('/webhook/:botId', (req, res) => {
  const { botId } = req.params;
  const bot = store.getBotById(botId);
  res.json({
    status: 'ok',
    botId,
    botFound: !!bot,
    botUsername: bot ? bot.bot_username : null
  });
});

/**
 * Dynamic Multi-Bot Webhook Endpoint
 * POST /telegram/webhook/:botId
 */
router.post('/webhook/:botId', async (req, res) => {
  const { botId } = req.params;
  let bot = store.getBotById(botId);

  if (!bot && BOT_TOKEN) {
    bot = await store.ensurePrimaryBot(BOT_TOKEN, SECRET_TOKEN, PUBLIC_BASE_URL);
  }

  if (!bot) {
    console.warn(`⚠️ [Webhook] Received update for unknown bot ID: ${botId}`);
    return res.status(404).send('Bot not found');
  }

  // Verify secret token
  const secretHeader = (req.get('X-Telegram-Bot-Api-Secret-Token') || '').trim();
  const expectedSecret = (bot.secret_token || SECRET_TOKEN || '').trim();

  if (expectedSecret && secretHeader && secretHeader !== expectedSecret) {
    console.warn(`⚠️ [Webhook] Secret token mismatch for bot @${bot.bot_username}:`);
    console.warn(`   Expected: "${expectedSecret}", Received: "${secretHeader}"`);

    if (ENFORCE_SECRET_TOKEN) {
      console.warn('   ⛔ Rejected request with 401 Unauthorized');
      return res.status(401).send('Unauthorized');
    }
  }

  const update = req.body;
  await handleIncomingUpdate(bot, update);

  return res.sendStatus(200);
});

/**
 * Primary Webhook Endpoint (default registered by set-webhook)
 * POST /telegram/webhook
 */
router.post('/webhook', async (req, res) => {
  const update = req.body;

  // 1. Resolve active bot (match by configured BOT_TOKEN or fallback to first registered bot)
  let bot = store.getBotByToken(BOT_TOKEN);

  if (!bot) {
    const allBots = store._coll('bots');
    bot = allBots.find(b => b.bot_token === BOT_TOKEN) || allBots[0];
  }

  if (!bot && BOT_TOKEN) {
    bot = await store.ensurePrimaryBot(BOT_TOKEN, SECRET_TOKEN, PUBLIC_BASE_URL);
  }

  if (!bot) {
    console.warn('⚠️ [Webhook] No registered bot found to handle incoming update.');
    console.warn('   Ensure TELEGRAM_BOT_TOKEN is set in your .env file.');
    return res.sendStatus(200);
  }

  // 2. Secret token check
  const secretHeader = (req.get('X-Telegram-Bot-Api-Secret-Token') || '').trim();
  const expectedSecret = (bot.secret_token || SECRET_TOKEN || '').trim();

  if (expectedSecret && secretHeader && secretHeader !== expectedSecret) {
    console.warn(`⚠️ [Webhook] Secret token mismatch on default webhook:`);
    console.warn(`   Expected: "${expectedSecret}", Received: "${secretHeader}"`);

    if (ENFORCE_SECRET_TOKEN) {
      console.warn('   ⛔ Rejected request with 401 Unauthorized');
      return res.status(401).send('Unauthorized');
    }
  }

  await handleIncomingUpdate(bot, update);

  return res.sendStatus(200);
});

/**
 * Shared Update Processing and Console Logging
 */
async function handleIncomingUpdate(bot, update) {
  if (!update) return;

  const updateId = update.update_id || 'N/A';

  if (update.message) {
    const msg = update.message;
    const from = msg.from || {};
    const senderName = [from.first_name, from.last_name].filter(Boolean).join(' ') || from.username || 'Anonymous';
    const text = msg.text || (msg.caption ? `[Media]: ${msg.caption}` : '[Non-text message]');

    console.log(`\n================== 📥 NEW TELEGRAM MESSAGE ==================`);
    console.log(`🤖 Target Bot   : @${bot.bot_username || 'SupportBot'} (ID: ${bot.id})`);
    console.log(`👤 From Customer : ${senderName} (@${from.username || 'none'}, ID: ${from.id})`);
    console.log(`💬 Message Text  : "${text}"`);
    console.log(`🕒 Update ID     : #${updateId}`);

    try {
      const result = await ingestTelegramMessage(bot, msg);
      if (result) {
        console.log(`🎫 Ticket Action : ${result.isNewTicket ? '⭐ NEW TICKET CREATED' : '🔄 EXISTING TICKET UPDATED'}`);
        console.log(`🏷️  Ticket Number : ${result.complaint.ticket_number}`);
        console.log(`📁 Category      : ${result.complaint.category.toUpperCase()}`);
        console.log(`⚡ Supabase Sync : Active (synced to PostgreSQL)`);
      }
    } catch (err) {
      console.error(`❌ Error ingesting message for bot @${bot.bot_username}:`, err.message);
    }
    console.log(`=============================================================\n`);
  } else if (update.callback_query) {
    console.log(`\n🔘 [Telegram Webhook] Callback query received from ID: ${update.callback_query.from?.id}`);
  } else {
    console.log(`\nℹ️ [Telegram Webhook] Received update #${updateId} (no direct message payload)`);
  }
}

export default router;
