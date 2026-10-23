import express from 'express';
import { store } from '../db/store.js';
import { ingestTelegramMessage } from '../services/complaintService.js';
import { ENFORCE_SECRET_TOKEN, BOT_TOKEN } from '../config.js';

const router = express.Router();

/**
 * Dynamic Multi-Bot Webhook Endpoint
 * Telegram delivers updates here for each linked bot:
 * POST /telegram/webhook/:botId
 */
router.post('/webhook/:botId', async (req, res) => {
  const { botId } = req.params;
  const bot = store.getBotById(botId);

  if (!bot) {
    console.warn(`⚠️ Received webhook for unknown bot ID: ${botId}`);
    return res.status(404).send('Bot not found');
  }

  // Verify secret token
  const secretHeader = (req.get('X-Telegram-Bot-Api-Secret-Token') || '').trim();
  const expectedSecret = (bot.secret_token || '').trim();

  if (expectedSecret && secretHeader !== expectedSecret) {
    console.warn(`⚠️ Secret token mismatch on webhook for bot @${bot.bot_username}:`);
    console.warn(`   Expected: "${expectedSecret}", Received: "${secretHeader || '(none)'}"`);

    if (ENFORCE_SECRET_TOKEN) {
      console.warn('   ⛔ Rejected request with 401 Unauthorized (ENFORCE_SECRET_TOKEN=1)');
      return res.status(401).send('Unauthorized');
    }
  }

  const update = req.body;

  if (update && update.message) {
    try {
      const result = await ingestTelegramMessage(bot, update.message);
      if (result) {
        console.log(`📩 [Bot @${bot.bot_username}] Ingested update for complaint [${result.complaint.ticket_number}] (${result.complaint.category})`);
      }
    } catch (err) {
      console.error(`❌ Error ingesting message for bot @${bot.bot_username}:`, err.message);
    }
  }

  return res.sendStatus(200);
});

/**
 * Legacy single-bot webhook endpoint for backwards compatibility
 * POST /telegram/webhook
 */
router.post('/webhook', async (req, res) => {
  // Find first active bot or fallback
  const allBots = store._coll('bots');
  const bot = allBots[0] || {
    id: 'legacy-bot',
    org_id: 'default-org',
    bot_token: BOT_TOKEN,
    bot_username: 'legacy_bot',
    secret_token: null
  };

  const update = req.body;
  if (update && update.message && allBots.length > 0) {
    try {
      await ingestTelegramMessage(bot, update.message);
    } catch (err) {
      console.error('Error handling legacy webhook message:', err.message);
    }
  }

  return res.sendStatus(200);
});

export default router;
