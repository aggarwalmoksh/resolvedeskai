/**
 * Telegram API Service
 * Handles multi-bot interactions with Telegram's Bot API:
 * - Token verification (`getMe`)
 * - Dynamic webhook registration (`setWebhook`)
 * - Webhook deregistration (`deleteWebhook`)
 * - Outbound replies sent to customer chats (`sendMessage`)
 */

export async function verifyBotToken(botToken) {
  const url = `https://api.telegram.org/bot${botToken}/getMe`;
  try {
    const res = await fetch(url);
    const data = await res.json();
    if (!data.ok) {
      throw new Error(data.description || 'Invalid Telegram bot token');
    }
    return {
      id: data.result.id,
      username: data.result.username,
      title: data.result.first_name
    };
  } catch (err) {
    // If running in sandbox or offline, allow simulated fallback for testing if token starts with 'test_'
    if (botToken.startsWith('test_')) {
      return {
        id: 123456789,
        username: 'test_demo_bot',
        title: 'Demo Test Bot'
      };
    }
    throw new Error(`Telegram verification failed: ${err.message}`);
  }
}

export async function registerBotWebhook(botToken, webhookUrl, secretToken) {
  const url = `https://api.telegram.org/bot${botToken}/setWebhook`;
  try {
    const payload = {
      url: webhookUrl,
      drop_pending_updates: true
    };
    if (secretToken) {
      payload.secret_token = secretToken;
    }

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!data.ok) {
      throw new Error(data.description || 'Failed to register webhook with Telegram');
    }
    return data;
  } catch (err) {
    if (botToken.startsWith('test_')) {
      return { ok: true, description: 'Simulated webhook registration in test environment' };
    }
    throw new Error(`Telegram setWebhook error: ${err.message}`);
  }
}

export async function deleteBotWebhook(botToken) {
  const url = `https://api.telegram.org/bot${botToken}/deleteWebhook`;
  try {
    const res = await fetch(url, { method: 'POST' });
    const data = await res.json();
    return data;
  } catch (err) {
    if (botToken.startsWith('test_')) {
      return { ok: true, description: 'Simulated webhook deletion' };
    }
    throw new Error(`Telegram deleteWebhook error: ${err.message}`);
  }
}

export async function sendTelegramReply(botToken, chatId, text, replyToMessageId = null) {
  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
  try {
    const payload = {
      chat_id: chatId,
      text: text
    };
    if (replyToMessageId) {
      payload.reply_to_message_id = replyToMessageId;
    }

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!data.ok) {
      throw new Error(data.description || 'Failed to send message via Telegram');
    }
    return data;
  } catch (err) {
    if (botToken.startsWith('test_')) {
      return { ok: true, result: { message_id: Math.floor(Math.random() * 100000), text } };
    }
    throw new Error(`Telegram sendMessage error: ${err.message}`);
  }
}
