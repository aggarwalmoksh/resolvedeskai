import { BOT_TOKEN } from './config.js';

if (!BOT_TOKEN) {
  console.error('❌ CRITICAL ERROR: TELEGRAM_BOT_TOKEN is missing in the .env file!');
  process.exit(1);
}

const telegramApiUrl = `https://api.telegram.org/bot${BOT_TOKEN}/getWebhookInfo`;

async function getWebhookInfo() {
  try {
    const res = await fetch(telegramApiUrl);
    const data = await res.json();
    if (data.ok) {
      console.log('📋 Current Telegram Webhook Status:');
      console.log(JSON.stringify(data.result, null, 2));
      if (data.result.last_error_message) {
        console.warn(`\n⚠️ Note: Telegram reported a recent delivery error: "${data.result.last_error_message}"`);
      }
    } else {
      console.error('❌ Telegram error:', data);
    }
  } catch (err) {
    console.error('❌ Connection to Telegram API failed:', err.message || err);
  }
}

getWebhookInfo();
