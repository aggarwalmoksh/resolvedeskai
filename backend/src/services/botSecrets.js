import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';

function encryptionKey() {
  const key = process.env.BOT_TOKEN_ENCRYPTION_KEY;
  if (!/^[a-f0-9]{64}$/i.test(key || '')) {
    throw new Error('BOT_TOKEN_ENCRYPTION_KEY must contain 64 hexadecimal characters.');
  }
  return Buffer.from(key, 'hex');
}

export function fingerprintToken(token) {
  return createHmac('sha256', encryptionKey()).update('telegram-token:').update(token).digest('hex');
}

export function protectBotToken(token, bot) {
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), nonce);
  cipher.setAAD(Buffer.from(`${bot.org_id}:${bot.id}`));
  const ciphertext = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  return {
    bot_token: ['v1', nonce, cipher.getAuthTag(), ciphertext]
      .map(value => typeof value === 'string' ? value : value.toString('base64url')).join('.'),
    bot_token_fingerprint: fingerprintToken(token),
    masked_token: token.length > 12 ? `${token.slice(0, 8)}…${token.slice(-3)}` : '••••',
  };
}

export function readBotToken(bot) {
  const [version, nonce, tag, ciphertext] = bot.bot_token.split('.');
  if (version !== 'v1' || !nonce || !tag || !ciphertext) throw new Error('Bot credential migration required.');
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(nonce, 'base64url'));
  decipher.setAAD(Buffer.from(`${bot.org_id}:${bot.id}`));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64url')), decipher.final()]).toString('utf8');
}
