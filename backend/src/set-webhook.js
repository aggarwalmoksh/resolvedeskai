import { BOT_TOKEN, SECRET_TOKEN, PUBLIC_BASE_URL } from './config.js';

// Support CLI arguments: npm run register-bot [-- [custom_url] [--drop-pending]]
const args = process.argv.slice(2);
const dropPending = args.includes('--drop-pending') || args.includes('--drop');
const customUrl = args.find(a => !a.startsWith('--'));
const baseUrl = customUrl || PUBLIC_BASE_URL;

if (!BOT_TOKEN) {
  console.error('❌ CRITICAL ERROR: TELEGRAM_BOT_TOKEN is missing in the .env file!');
  process.exit(1);
}

if (!baseUrl || baseUrl === 'https://your-tunnel.example.com') {
  console.error('❌ ERROR: PUBLIC_BASE_URL is not configured or still set to the placeholder.');
  console.error('👉 Please update PUBLIC_BASE_URL in your .env file with your public tunnel URL (e.g., https://xxxx.ngrok-free.app),');
  console.error('   or pass it directly as a CLI argument: npm run register-bot -- https://xxxx.ngrok-free.app\n');
  process.exit(1);
}

const cleanBaseUrl = baseUrl.replace(/\/+$/, '');
const webhookUrl = `${cleanBaseUrl}/telegram/webhook`;
const telegramApiUrl = `https://api.telegram.org/bot${BOT_TOKEN}/setWebhook`;

console.log(`Setting Telegram webhook...`);
console.log(`- Webhook URL: ${webhookUrl}`);
console.log(`- Secret Token: ${SECRET_TOKEN ? `"${SECRET_TOKEN}"` : '(none)'}`);
if (dropPending) {
  console.log(`- Drop pending updates: YES`);
}

async function registerWebhook() {
  try {
    const payload = {
      url: webhookUrl,
      drop_pending_updates: dropPending
    };

    if (SECRET_TOKEN) {
      payload.secret_token = SECRET_TOKEN;
    }

    const response = await fetch(telegramApiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await response.json();

    if (data.ok) {
      console.log('✅ Webhook registered successfully with Telegram!');
      console.log('Telegram response:', data.description || data);
    } else {
      console.error('❌ Failed to register webhook:');
      console.error(data);
    }
  } catch (err) {
    console.error('❌ Connection to Telegram API failed:', err.message || err);
  }
}

registerWebhook();
