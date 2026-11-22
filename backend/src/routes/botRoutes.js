import { readBotToken } from '../services/botSecrets.js';
import express from 'express';
import crypto from 'crypto';
import { authMiddleware } from '../middleware/authMiddleware.js';
import { requirePermission } from '../middleware/rbacMiddleware.js';
import { checkBotQuota } from '../middleware/quotaMiddleware.js';
import { store } from '../db/store.js';
import { verifyBotToken, registerBotWebhook, deleteBotWebhook } from '../services/telegramService.js';
import { PUBLIC_BASE_URL } from '../config.js';

const router = express.Router();
router.use(authMiddleware);

function publicBot({ id, bot_username, bot_title, masked_token, webhook_url, status, created_at }) {
  return { id, bot_username, bot_title, masked_token, webhook_url, status, created_at };
}

/**
 * GET /api/bots
 * List all linked Telegram bots for the organization
 */
router.get('/', async (req, res, next) => {
  try {
    const bots = (await store.getBotsByOrg(req.org.id)).map(publicBot);

    res.json({
      status: 'success',
      data: {
        bots,
        quota: {
          used: bots.length,
          max: req.org.max_bots
        }
      }
    });
  } catch (error) { next(error); }
});

/**
 * POST /api/bots
 * Link a new Telegram bot
 */
router.post('/', requirePermission('can_manage_bots'), checkBotQuota, async (req, res) => {
  try {
    const { bot_token, bot_title } = req.body;
    if (typeof bot_token !== 'string' || !bot_token.trim()) {
      return res.status(400).json({ error: 'bot_token is required' });
    }

    const cleanToken = bot_token.trim();

    const testToken = process.env.NODE_ENV !== 'production' && cleanToken.startsWith('test_');
    if (!testToken && !/^\d+:[A-Za-z0-9_-]+$/.test(cleanToken)) {
      return res.status(400).json({ error: 'Enter a valid Telegram bot token.' });
    }

    // Check if token already linked to any organization
    const existing = await store.getBotByToken(cleanToken);
    if (existing) {
      return res.status(400).json({ error: 'This Telegram bot is already linked to an organization' });
    }

    // 1. Verify token with Telegram API
    const botInfo = await verifyBotToken(cleanToken);

    // 2. Generate unique secret token and webhook URL
    const secretToken = crypto.randomBytes(24).toString('hex');
    const tempBotId = crypto.randomUUID();
    const baseUrl = (PUBLIC_BASE_URL || 'http://localhost:4000').replace(/\/+$/, '');
    const webhookUrl = `${baseUrl}/telegram/webhook/${tempBotId}`;

    // 4. Save to store
    const newBot = await store.createBot({
      id: tempBotId,
      org_id: req.org.id,
      bot_token: cleanToken,
      bot_username: botInfo.username,
      bot_title: bot_title || botInfo.title || botInfo.username,
      secret_token: secretToken,
      webhook_url: webhookUrl
    });

    // Reserve the token before registering so a concurrent link cannot replace the webhook.
    try {
      await registerBotWebhook(cleanToken, webhookUrl, secretToken);
    } catch {
      console.warn('Telegram webhook registration failed. Use Sync to retry.');
    }

    res.status(201).json({
      status: 'success',
      message: `Bot @${newBot.bot_username} linked successfully!`,
      data: publicBot(newBot)
    });
  } catch (err) {
    res.status(400).json({ status: 'error', error: err.code === '23505' ? 'This Telegram bot is already linked.' : 'Could not complete the bot operation.' });
  }
});

/**
 * DELETE /api/bots/:id
 * Unlink a bot
 */
router.delete('/:id', requirePermission('can_manage_bots'), async (req, res) => {
  try {
    const bot = await store.getBotById(req.params.id, req.org.id);
    if (!bot || bot.org_id !== req.org.id) {
      return res.status(404).json({ error: 'Bot not found in your organization' });
    }

    // Deregister webhook from Telegram
    try {
      await deleteBotWebhook(readBotToken(bot));
    } catch (err) {
      console.warn('⚠️ Failed to delete webhook from Telegram:', err.message);
    }

    await store.deleteBot(bot.id, req.org.id);

    res.json({
      status: 'success',
      message: `Bot @${bot.bot_username} unlinked successfully`
    });
  } catch (err) {
    res.status(400).json({ status: 'error', error: err.code === '23505' ? 'This Telegram bot is already linked.' : 'Could not complete the bot operation.' });
  }
});

/**
 * POST /api/bots/:id/sync
 * Force re-sync webhook with Telegram
 */
router.post('/:id/sync', requirePermission('can_manage_bots'), async (req, res) => {
  try {
    const bot = await store.getBotById(req.params.id, req.org.id);
    if (!bot || bot.org_id !== req.org.id) {
      return res.status(404).json({ error: 'Bot not found in your organization' });
    }

    const baseUrl = (PUBLIC_BASE_URL || 'http://localhost:4000').replace(/\/+$/, '');
    const webhookUrl = `${baseUrl}/telegram/webhook/${bot.id}`;

    await registerBotWebhook(readBotToken(bot), webhookUrl, bot.secret_token);
    await store.updateBot(bot.id, req.org.id, { webhook_url: webhookUrl, status: 'active' });

    res.json({
      status: 'success',
      message: `Webhook for @${bot.bot_username} successfully synced with Telegram!`,
      webhook_url: webhookUrl
    });
  } catch (err) {
    res.status(400).json({ status: 'error', error: err.code === '23505' ? 'This Telegram bot is already linked.' : 'Could not complete the bot operation.' });
  }
});


/**
 * POST /api/bots/:id/activate
 * Activate a paused bot (swaps active bot if at plan limit)
 */
router.post('/:id/activate', requirePermission('can_manage_bots'), async (req, res) => {
  try {
    const targetBot = await store.getBotById(req.params.id, req.org.id);
    if (!targetBot || targetBot.org_id !== req.org.id) {
      return res.status(404).json({ error: 'Bot not found in your organization' });
    }

    const orgBots = await store.getBotsByOrg(req.org.id, { includeCredentials: true });
    const activeBots = orgBots.filter(b => b.status === 'active' && b.id !== targetBot.id);

    // If active bots meet max quota, pause the oldest active bot to make room
    if (activeBots.length >= req.org.max_bots) {
      const botToPause = activeBots[activeBots.length - 1];
      await store.updateBot(botToPause.id, req.org.id, { status: 'paused' });
      try {
        await deleteBotWebhook(readBotToken(botToPause));
        console.log(`⏸️  [Quota Shift] Paused bot @${botToPause.bot_username} to activate @${targetBot.bot_username}`);
      } catch (e) {}
    }

    // Activate target bot and re-register webhook
    const activated = await store.updateBot(targetBot.id, req.org.id, { status: 'active' });
    try {
      if (targetBot.webhook_url && targetBot.secret_token) {
        await registerBotWebhook(readBotToken(targetBot), targetBot.webhook_url, targetBot.secret_token);
      }
    } catch (e) {}

    res.json({
      status: 'success',
      message: `Bot @${targetBot.bot_username} is now active!`,
      data: publicBot(activated)
    });
  } catch (err) {
    res.status(500).json({ error: err.code === '23505' ? 'This Telegram bot is already linked.' : 'Could not complete the bot operation.' });
  }
});

/**
 * POST /api/bots/:id/pause
 * Manually pause a bot and disconnect its webhook
 */
router.post('/:id/pause', requirePermission('can_manage_bots'), async (req, res) => {
  try {
    const targetBot = await store.getBotById(req.params.id, req.org.id);
    if (!targetBot || targetBot.org_id !== req.org.id) {
      return res.status(404).json({ error: 'Bot not found in your organization' });
    }

    const paused = await store.updateBot(targetBot.id, req.org.id, { status: 'paused' });
    try {
      await deleteBotWebhook(readBotToken(targetBot));
    } catch (e) {}

    res.json({
      status: 'success',
      message: `Bot @${targetBot.bot_username} has been paused`,
      data: publicBot(paused)
    });
  } catch (err) {
    res.status(500).json({ error: err.code === '23505' ? 'This Telegram bot is already linked.' : 'Could not complete the bot operation.' });
  }
});

export default router;
