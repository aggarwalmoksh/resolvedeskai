import { BOT_TOKEN } from './config.js';

if (!BOT_TOKEN) {
  console.error('❌ CRITICAL ERROR: TELEGRAM_BOT_TOKEN is missing in the .env file!');
  process.exit(1);
}

const telegramApiUrl = `https://api.telegram.org/bot${BOT_TOKEN}/deleteWebhook`;

async function deleteWebhook() {
  try {
    const res = await fetch(telegramApiUrl, { method: 'POST' });
    const data = await res.json();
    if (data.ok) {
      console.log('✅ Webhook deleted from Telegram.');
      console.log('Telegram response:', data.description || data);
    } else {
      console.error('❌ Telegram error:', data);
    }
  } catch (err) {
    console.error('❌ Connection to Telegram API failed:', err.message || err);
  }
}

deleteWebhook();
