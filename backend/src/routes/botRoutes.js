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

/**
 * GET /api/bots
 * List all linked Telegram bots for the organization
 */
router.get('/', (req, res) => {
  const bots = store.getBotsByOrg(req.org.id).map(b => {
    // Mask bot token for security
    const maskedToken = b.bot_token.length > 10 ? `${b.bot_token.substring(0, 6)}...${b.bot_token.substring(b.bot_token.length - 4)}` : '***';
    return {
      id: b.id,
      bot_username: b.bot_username,
      bot_title: b.bot_title,
      masked_token: maskedToken,
      webhook_url: b.webhook_url,
      status: b.status,
      created_at: b.created_at
    };
  });

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
});

/**
 * POST /api/bots
 * Link a new Telegram bot
 */
router.post('/', requirePermission('can_manage_bots'), checkBotQuota, async (req, res) => {
  try {
    const { bot_token, bot_title } = req.body;
    if (!bot_token) {
      return res.status(400).json({ error: 'bot_token is required' });
    }

    const cleanToken = bot_token.trim();

    // Check if token already linked to any organization
    const existing = store.getBotByToken(cleanToken);
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

    // 3. Register webhook with Telegram
    try {
      await registerBotWebhook(cleanToken, webhookUrl, secretToken);
    } catch (err) {
      console.warn('⚠️ Webhook registration with Telegram failed (might be offline/dev):', err.message);
    }

    // 4. Save to store
    const bot = store._coll('bots');
    const newBot = {
      id: tempBotId,
      org_id: req.org.id,
      bot_token: cleanToken,
      bot_username: botInfo.username,
      bot_title: bot_title || botInfo.title || botInfo.username,
      secret_token: secretToken,
      webhook_url: webhookUrl,
      status: 'active',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    bot.push(newBot);
    store.save();

    res.status(201).json({
      status: 'success',
      message: `Bot @${newBot.bot_username} linked successfully!`,
      data: {
        id: newBot.id,
        bot_username: newBot.bot_username,
        bot_title: newBot.bot_title,
        webhook_url: newBot.webhook_url,
        status: newBot.status
      }
    });
  } catch (err) {
    res.status(400).json({ status: 'error', error: err.message });
  }
});

/**
 * DELETE /api/bots/:id
 * Unlink a bot
 */
router.delete('/:id', requirePermission('can_manage_bots'), async (req, res) => {
  try {
    const bot = store.getBotById(req.params.id);
    if (!bot || bot.org_id !== req.org.id) {
      return res.status(404).json({ error: 'Bot not found in your organization' });
    }

    // Deregister webhook from Telegram
    try {
      await deleteBotWebhook(bot.bot_token);
    } catch (err) {
      console.warn('⚠️ Failed to delete webhook from Telegram:', err.message);
    }

    store.deleteBot(bot.id);

    res.json({
      status: 'success',
      message: `Bot @${bot.bot_username} unlinked successfully`
    });
  } catch (err) {
    res.status(400).json({ status: 'error', error: err.message });
  }
});

/**
 * POST /api/bots/:id/sync
 * Force re-sync webhook with Telegram
 */
router.post('/:id/sync', requirePermission('can_manage_bots'), async (req, res) => {
  try {
    const bot = store.getBotById(req.params.id);
    if (!bot || bot.org_id !== req.org.id) {
      return res.status(404).json({ error: 'Bot not found in your organization' });
    }

    const baseUrl = (PUBLIC_BASE_URL || 'http://localhost:4000').replace(/\/+$/, '');
    const webhookUrl = `${baseUrl}/telegram/webhook/${bot.id}`;

    await registerBotWebhook(bot.bot_token, webhookUrl, bot.secret_token);
    store.updateBot(bot.id, { webhook_url: webhookUrl, status: 'active' });

    res.json({
      status: 'success',
      message: `Webhook for @${bot.bot_username} successfully synced with Telegram!`,
      webhook_url: webhookUrl
    });
  } catch (err) {
    res.status(400).json({ status: 'error', error: err.message });
  }
});

export default router;
