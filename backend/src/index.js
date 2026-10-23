import express from 'express';
import { PORT, BOT_TOKEN, SECRET_TOKEN, ECHO, ENFORCE_SECRET_TOKEN } from './config.js';

// Safety check for bot token
if (!BOT_TOKEN) {
  console.error('❌ CRITICAL ERROR: TELEGRAM_BOT_TOKEN is missing in the .env file!');
  process.exit(1);
}

const app = express();
app.use(express.json());

// Send message helper using the Telegram Bot API
export async function sendTelegramMessage(chatId, text) {
  const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: text
    })
  });

  const data = await response.json();
  if (!data.ok) {
    throw new Error(data.description || 'Failed to send message via Telegram Bot API');
  }
  return data;
}

// Health check endpoint
app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    service: 'ResolveDesk Telegram Bot API',
    webhook: '/telegram/webhook'
  });
});

// Telegram webhook endpoint
app.post('/telegram/webhook', async (req, res) => {
  const secretHeader = req.get('X-Telegram-Bot-Api-Secret-Token');
  const cleanHeader = (secretHeader || '').trim();
  const cleanSecret = (SECRET_TOKEN || '').trim();

  // Validate secret token if configured
  if (cleanSecret && cleanHeader !== cleanSecret) {
    console.warn('⚠️ Webhook secret token mismatch:');
    console.warn(`   • Expected from .env: "${cleanSecret}"`);
    console.warn(`   • Received from Telegram header: "${cleanHeader || '(none - Telegram sent no secret header)'}"`);

    if (ENFORCE_SECRET_TOKEN) {
      console.warn('   ⛔ Rejected request with 401 Unauthorized (ENFORCE_SECRET_TOKEN=1)');
      return res.status(401).send('Unauthorized');
    } else {
      console.warn('   ⚠️ Allowing message through because ENFORCE_SECRET_TOKEN is not enabled.');
      console.warn('   👉 To update Telegram with your current secret, run: npm run register-bot\n');
    }
  }

  const update = req.body;

  if (update && update.message) {
    const message = update.message;
    const chatId = message.chat?.id;
    const text = message.text;
    const sender = message.from?.username || message.from?.first_name || 'User';

    console.log(`📩 Received message from ${sender} (${chatId}): ${text ?? '[Non-text message]'}`);

    // If ECHO is enabled in .env, reply back to user
    if (ECHO && chatId && text) {
      try {
        await sendTelegramMessage(chatId, `Received: ${text}`);
        console.log(`📤 Echo replied to chat ${chatId}`);
      } catch (err) {
        console.error(`❌ Failed to send echo reply to ${chatId}:`, err.message);
      }
    }
  }

  // Always return 200 OK promptly so Telegram knows update was received
  return res.sendStatus(200);
});

app.listen(PORT, () => {
  console.log(`🚀 Server is running on port ${PORT}`);
  console.log(`📡 Webhook endpoint: http://localhost:${PORT}/telegram/webhook`);
  console.log(`🔁 Echo mode: ${ECHO ? 'ENABLED' : 'DISABLED'}`);
  console.log(`🔒 Secret token verification: ${SECRET_TOKEN ? (ENFORCE_SECRET_TOKEN ? 'STRICT (401 on mismatch)' : 'PERMISSIVE (warn on mismatch)') : 'DISABLED'}`);
});