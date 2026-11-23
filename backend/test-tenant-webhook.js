import assert from 'node:assert/strict';
import { once } from 'node:events';
import { test } from 'node:test';
import express from 'express';
import { store } from './src/db/store.js';
import botRoutes from './src/routes/botRoutes.js';
import complaintRoutes from './src/routes/complaintRoutes.js';
import webhookRoutes from './src/routes/webhookRoutes.js';
import workspaceEvents from './src/routes/workspaceEvents.js';
import { protectBotToken, readBotToken } from './src/services/botSecrets.js';

const org = { id: 'org-a', max_bots: 1 };
const owner = { id: 'member-a', org_id: org.id, is_active: true, role: 'owner' };
const bot = {
  id: '5f451eb0-5549-44a6-a790-d87cd2de50ac', org_id: org.id,
  secret_token: 'backend-only-secret', status: 'active', bot_username: 'test_bot',
};
const token = '123456789:backend-only-bot-token';

test('encryption is randomized and ciphertext is bound to the bot and organization', () => {
  process.env.BOT_TOKEN_ENCRYPTION_KEY = 'a1'.repeat(32);
  const first = protectBotToken(token, bot);
  const second = protectBotToken(token, bot);
  assert.notEqual(first.bot_token, second.bot_token);
  assert.equal(first.bot_token_fingerprint, second.bot_token_fingerprint);
  assert.equal(readBotToken({ ...bot, ...first }), token);
  assert.throws(() => readBotToken({ ...bot, ...first, org_id: 'org-b' }));
  assert.throws(() => readBotToken({ ...bot, bot_token: token }));
});

test('API scopes reads, strips bot credentials, and gates Telegram updates before enqueue', async t => {
  process.env.BOT_TOKEN_ENCRYPTION_KEY = 'a1'.repeat(32);
  const encryptedBot = { ...bot, ...protectBotToken(token, bot) };
  const queued = new Set();
  let failQueue = false;
  let revision = '1';
  t.mock.method(store, 'getUserByClerkId', async () => owner);
  t.mock.method(store, 'getOrgById', async () => org);
  t.mock.method(store, 'getBotsByOrg', async id => {
    assert.equal(id, org.id);
    return [encryptedBot];
  });
  for (const method of ['getBotById', 'getComplaintById']) {
    t.mock.method(store, method, async (id, orgId) => {
      assert.equal(id, 'org-b-resource');
      assert.equal(orgId, org.id);
      return null;
    });
  }
  t.mock.method(store, 'getWorkspaceRevision', async id => {
    assert.equal(id, org.id);
    return revision;
  });
  t.mock.method(store, 'getWebhookBot', async () => bot);
  t.mock.method(store, 'enqueueTelegramUpdate', async (target, id, payload) => {
    if (failQueue) throw new Error('database offline');
    assert.equal(target.org_id, org.id);
    assert.equal(payload.category, 'billing');
    queued.add(`${target.id}:${id}`);
  });
  t.mock.method(store, 'processTelegramUpdate', async () => null);

  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    if (req.get('x-test-member')) {
      req.auth = Object.assign(() => ({ userId: 'clerk-a', tokenType: 'session_token' }), {
        [Symbol.for('@clerk/express.auth')]: true,
      });
    }
    next();
  });
  app.use('/bots', botRoutes);
  app.use('/complaints', complaintRoutes);
  app.use('/events', workspaceEvents);
  app.use('/telegram', webhookRoutes);

  const server = app.listen(0, '127.0.0.1');
  t.after(() => { server.closeAllConnections(); server.close(); });
  await once(server, 'listening');
  const endpoint = `http://127.0.0.1:${server.address().port}`;
  const member = { 'x-test-member': 'owner' };

  const list = await fetch(`${endpoint}/bots`, { headers: member });
  assert.equal(list.status, 200);
  const listed = (await list.json()).data.bots[0];
  assert.equal(listed.masked_token, encryptedBot.masked_token);
  for (const field of ['bot_token', 'bot_token_fingerprint', 'secret_token']) assert.equal(listed[field], undefined);
  assert.equal((await fetch(`${endpoint}/complaints/org-b-resource`, { headers: member })).status, 404);
  assert.equal((await fetch(`${endpoint}/bots/org-b-resource/pause`, { method: 'POST', headers: member })).status, 404);
  assert.equal((await fetch(`${endpoint}/events`)).status, 401);
  const events = await fetch(`${endpoint}/events`, { headers: member });
  assert.match(events.headers.get('content-type'), /^text\/event-stream/);
  const reader = events.body.getReader();
  assert.equal(new TextDecoder().decode((await reader.read()).value), 'data: ready\n\n');
  revision = '2';
  assert.equal(new TextDecoder().decode((await reader.read()).value), 'data: changed\n\n');
  await reader.cancel();

  const update = {
    update_id: 0, message: { message_id: 1, from: { id: 10 }, chat: { id: 10 }, text: 'Please refund me' },
  };
  const send = (secret, text = update.message.text) => fetch(`${endpoint}/telegram/webhook/${bot.id}`, {
    method: 'POST', body: JSON.stringify({ ...update, message: { ...update.message, text } }), headers: {
      'content-type': 'application/json', ...(secret ? { 'x-telegram-bot-api-secret-token': secret } : {}),
    },
  });
  assert.equal((await send()).status, 401);
  assert.equal((await send('wrong')).status, 401);
  assert.equal((await send(bot.secret_token, '/start referral')).status, 200);
  assert.equal((await send(bot.secret_token, 'Hello!')).status, 200);
  assert.equal(queued.size, 0);
  failQueue = true;
  assert.equal((await send(bot.secret_token)).status, 503);
  failQueue = false;
  assert.equal((await send(bot.secret_token)).status, 200);
  assert.equal((await send(bot.secret_token)).status, 200);
  assert.deepEqual([...queued], [`${bot.id}:0`]);
});
