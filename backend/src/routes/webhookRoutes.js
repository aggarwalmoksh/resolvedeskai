import express from 'express';
import { createHash, timingSafeEqual } from 'node:crypto';
import { store } from '../db/store.js';
import { detectCategory } from '../services/complaintService.js';
import { wakeTelegramWorker } from '../services/telegramWorker.js';
import { BOT_TOKEN, SECRET_TOKEN } from '../config.js';

const router = express.Router();
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const digest = value => createHash('sha256').update(value).digest();

router.get('/webhook', (req, res) => res.json({ status: 'ok' }));

router.post(['/webhook/:botId', '/webhook'], async (req, res) => {
  const supplied = req.get('X-Telegram-Bot-Api-Secret-Token');
  if (!supplied || (req.params.botId && !uuid.test(req.params.botId))) return res.sendStatus(401);

  try {
    const bot = req.params.botId
      ? await store.getWebhookBot(req.params.botId)
      : BOT_TOKEN && await store.getBotByToken(BOT_TOKEN);
    const expected = req.params.botId ? bot?.secret_token : SECRET_TOKEN || bot?.secret_token;
    if (!bot || !expected || !timingSafeEqual(digest(supplied), digest(expected))) return res.sendStatus(401);
    if (bot.status !== 'active') return res.sendStatus(200);

    const { update_id: updateId, message } = req.body || {};
    if (!Number.isSafeInteger(updateId) || updateId < 0) return res.sendStatus(400);
    if (!message?.from || !Number.isSafeInteger(message.from.id) ||
        !Number.isSafeInteger(message.chat?.id) || !Number.isSafeInteger(message.message_id)) {
      return res.sendStatus(200);
    }
    const source = message.text || message.caption;
    const text = typeof source === 'string' && source ? source : '[Non-text message]';
    const field = value => typeof value === 'string' ? value.slice(0, 255) : null;
    await store.enqueueTelegramUpdate(bot, updateId, {
      user_id: message.from.id,
      chat_id: message.chat.id,
      message_id: message.message_id,
      username: field(message.from.username),
      first_name: field(message.from.first_name),
      last_name: field(message.from.last_name),
      phone: field(message.contact?.phone_number)?.slice(0, 32),
      text,
      category: detectCategory(text),
    });
    res.sendStatus(200);
    wakeTelegramWorker();
  } catch (error) {
    console.error('Could not persist Telegram update.', error.code || error.name);
    res.sendStatus(503);
  }
});

export default router;
