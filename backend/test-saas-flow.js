/**
 * ResolveDesk SaaS Backend - End-to-End User Journey Test
 */

import { store } from './src/db/store.js';
import app from './src/index.js';

// Reset in-memory store for clean idempotent test run
store.data = {
  organizations: [],
  users: [],
  bots: [],
  customers: [],
  complaints: [],
  complaint_messages: [],
  invitations: []
};
store.save();

let passedChecks = 0;
function assert(condition, message) {
  if (!condition) {
    console.error(`❌ ASSERTION FAILED: ${message}`);
    process.exit(1);
  }
  console.log(`✅ [PASS] ${message}`);
  passedChecks++;
}

async function runTests() {
  console.log('\n======================================================');
  console.log('🧪 Starting ResolveDesk End-to-End User Story Tests');
  console.log('======================================================\n');

  // Direct Express dispatch helper
  const apiCall = async (method, path, body = null, token = null) => {
    return new Promise((resolve) => {
      const headers = { 'content-type': 'application/json' };
      if (token) {
        headers['authorization'] = `Bearer ${token}`;
        headers['Authorization'] = `Bearer ${token}`;
      }

      // Mock Express Request & Response
      const req = {
        method,
        url: path,
        originalUrl: path,
        headers,
        get: function(h) {
          const lower = h.toLowerCase();
          return this.headers[lower] || this.headers[h];
        },
        body: body || {},
        params: {},
        query: {}
      };

      // Extract query params if present
      if (path.includes('?')) {
        const [basePath, qs] = path.split('?');
        req.url = basePath;
        req.originalUrl = basePath;
        const searchParams = new URLSearchParams(qs);
        for (const [k, v] of searchParams.entries()) {
          req.query[k] = v;
        }
      }

      let statusCode = 200;
      let responseBody = null;

      const res = {
        statusCode: 200,
        status(code) { statusCode = code; return this; },
        json(data) { responseBody = data; resolve({ status: statusCode, body: data }); },
        send(data) { responseBody = data; resolve({ status: statusCode, body: data }); },
        sendStatus(code) { statusCode = code; resolve({ status: statusCode, body: null }); },
        header() {},
        setHeader() {}
      };

      app.handle(req, res);
    });
  };

  // --------------------------------------------------------------------------
  // STEP 1: Flower Shop Owner Registers Business
  // --------------------------------------------------------------------------
  console.log('\n--- 1. Flower Shop Owner Registration ---');
  const regRes = await apiCall('POST', '/api/auth/register', {
    name: 'Lila Vance',
    phone: '9876543210',
    password: 'securePassword123',
    businessName: "Lila's Blossom Boutique",
    subscriptionTier: 'starter'
  });

  assert(regRes.status === 201, 'Owner registration returns HTTP 201');
  assert(regRes.body.data.org.name === "Lila's Blossom Boutique", 'Org created with business name');
  assert(regRes.body.data.org.max_bots === 1, 'Starter plan allows 1 bot');
  assert(regRes.body.data.org.max_members === 3, 'Starter plan allows 3 members');
  assert(regRes.body.data.token, 'Owner receives JWT token');

  const ownerToken = regRes.body.data.token;
  const orgId = regRes.body.data.org.id;

  // --------------------------------------------------------------------------
  // STEP 2: Subscription Status & Quota Verification
  // --------------------------------------------------------------------------
  console.log('\n--- 2. Subscription Status & Quota Checks ---');
  const subRes = await apiCall('GET', '/api/subscription', null, ownerToken);
  assert(subRes.status === 200, 'Fetched subscription details');
  assert(subRes.body.data.usage.bots.current === 0, '0 bots currently used');
  assert(subRes.body.data.usage.bots.max === 1, 'Max 1 bot allowed');

  // --------------------------------------------------------------------------
  // STEP 3: Link First Bot & Test Bot Limit Enforcement
  // --------------------------------------------------------------------------
  console.log('\n--- 3. Bot Linking & Quota Enforcement ---');
  const bot1Res = await apiCall('POST', '/api/bots', {
    bot_token: 'test_token_flower_bot_1',
    bot_title: 'Flower Shop Complaint Bot'
  }, ownerToken);

  assert(bot1Res.status === 201, 'First bot successfully linked');
  assert(bot1Res.body.data.webhook_url.includes('/telegram/webhook/'), 'Dynamic webhook URL generated');
  const bot1Id = bot1Res.body.data.id;

  // Attempt to link a second bot (should fail due to 1 bot quota on Starter)
  const bot2Attempt = await apiCall('POST', '/api/bots', {
    bot_token: 'test_token_flower_bot_2',
    bot_title: 'Delivery Bot'
  }, ownerToken);

  assert(bot2Attempt.status === 403, 'Second bot rejected with 403 (Quota Exceeded)');
  assert(bot2Attempt.body.error.includes('Bot limit reached'), 'Quota error message returned');

  // --------------------------------------------------------------------------
  // STEP 4: Upgrade Subscription to Growth Plan (Allows 3 bots, 10 members)
  // --------------------------------------------------------------------------
  console.log('\n--- 4. Subscription Upgrade to Growth ---');
  const upgradeRes = await apiCall('POST', '/api/subscription/upgrade', {
    plan_id: 'growth'
  }, ownerToken);

  assert(upgradeRes.status === 200, 'Subscription successfully upgraded');
  assert(upgradeRes.body.data.new_limits.max_bots === 3, 'New bot limit is 3');
  assert(upgradeRes.body.data.new_limits.max_members === 10, 'New member limit is 10');

  // Now linking second bot should succeed
  const bot2Res = await apiCall('POST', '/api/bots', {
    bot_token: 'test_token_flower_bot_2',
    bot_title: 'Delivery Support Bot'
  }, ownerToken);
  assert(bot2Res.status === 201, 'Second bot successfully linked after upgrade');
  const bot2Id = bot2Res.body.data.id;

  // --------------------------------------------------------------------------
  // STEP 5: Invite Team Members & Configure Granular Permissions
  // --------------------------------------------------------------------------
  console.log('\n--- 5. Team Invites & Granular Permissions ---');
  const inviteRes = await apiCall('POST', '/api/team/invite', {
    phone: '9876543211',
    role: 'agent',
    permissions: {
      can_reply: true,
      can_update_status: true,
      can_assign: false // Cannot assign tickets
    }
  }, ownerToken);

  assert(inviteRes.status === 201, 'Invitation generated');
  const inviteCode = inviteRes.body.data.invitation.invite_code;

  // Invited member joins
  const joinRes = await apiCall('POST', '/api/team/accept-invite', {
    invite_code: inviteCode,
    name: 'Maya Patel',
    password: 'partnerPassword123'
  });

  assert(joinRes.status === 201, 'Invited partner successfully registered');
  const agentToken = joinRes.body.data.token;
  const agentUserId = joinRes.body.data.user.id;

  // --------------------------------------------------------------------------
  // STEP 6: Customer Sends Telegram Complaint (Dynamic Webhook)
  // --------------------------------------------------------------------------
  console.log('\n--- 6. Ingest Customer Complaint via Telegram Webhook ---');
  const customerTelegramId = 88776655;
  const webhookPayload = {
    update_id: 10001,
    message: {
      message_id: 501,
      from: {
        id: customerTelegramId,
        is_bot: false,
        first_name: 'David',
        last_name: 'Miller',
        username: 'david_m'
      },
      chat: { id: customerTelegramId },
      date: Math.floor(Date.now() / 1000),
      text: 'My anniversary flower bouquet was delivered damaged and wilting! Please help.'
    }
  };

  const webhookRes = await apiCall('POST', `/telegram/webhook/${bot1Id}`, webhookPayload);
  assert(webhookRes.status === 200, 'Webhook processed and returned 200 OK');

  // --------------------------------------------------------------------------
  // STEP 7: Verify Complaint Ingestion & Auto-Categorization
  // --------------------------------------------------------------------------
  console.log('\n--- 7. Verify Complaint in Portal ---');
  const listRes = await apiCall('GET', '/api/complaints', null, ownerToken);
  assert(listRes.status === 200, 'Fetched complaints list');
  assert(listRes.body.count === 1, '1 complaint found');

  const complaint = listRes.body.data[0];
  assert(complaint.ticket_number.startsWith('#TICK-'), 'Ticket number generated');
  assert(complaint.category === 'product', 'Auto-categorized as "product" due to "damaged/wilting" keywords');
  assert(complaint.status === 'pending', 'Initial status is pending');
  assert(complaint.customer.name === 'David Miller', 'Customer name recorded');

  // --------------------------------------------------------------------------
  // STEP 8: Dashboard Metrics Verification
  // --------------------------------------------------------------------------
  console.log('\n--- 8. Dashboard Metrics Verification ---');
  const dashRes = await apiCall('GET', '/api/dashboard/stats', null, ownerToken);
  assert(dashRes.status === 200, 'Dashboard stats fetched');
  assert(dashRes.body.data.complaints.total === 1, 'Total complaints is 1');
  assert(dashRes.body.data.complaints.pending === 1, 'Pending complaints is 1');
  assert(dashRes.body.data.resources.active_bots === 2, '2 active linked bots reported');

  const catRes = await apiCall('GET', '/api/dashboard/categories', null, ownerToken);
  const productCat = catRes.body.data.breakdown.find(c => c.category === 'product');
  assert(productCat && productCat.count === 1, 'Category breakdown shows 1 product complaint');

  // --------------------------------------------------------------------------
  // STEP 9: RBAC Enforcement & Ticket Assignment
  // --------------------------------------------------------------------------
  console.log('\n--- 9. RBAC Permissions & Assignment ---');
  // Agent tries to assign ticket (should fail: can_assign is false)
  const forbiddenAssign = await apiCall('PATCH', `/api/complaints/${complaint.id}/assign`, {
    assigned_to: agentUserId
  }, agentToken);

  assert(forbiddenAssign.status === 403, 'Agent without can_assign permission blocked with 403');

  // Owner assigns ticket to Agent
  const ownerAssign = await apiCall('PATCH', `/api/complaints/${complaint.id}/assign`, {
    assigned_to: agentUserId
  }, ownerToken);

  assert(ownerAssign.status === 200, 'Owner successfully assigned ticket to agent');

  // --------------------------------------------------------------------------
  // STEP 10: Staff Reply to Customer & Ticket Resolution
  // --------------------------------------------------------------------------
  console.log('\n--- 10. Staff Reply via Portal & Resolution ---');
  // Agent replies to customer
  const replyRes = await apiCall('POST', `/api/complaints/${complaint.id}/reply`, {
    text: 'Hello David, we sincerely apologize for the condition of your bouquet. We have dispatched a fresh luxury bouquet for immediate delivery today.'
  }, agentToken);

  assert(replyRes.status === 201, 'Staff reply recorded in thread');

  // Verify complaint detail thread
  const detailRes = await apiCall('GET', `/api/complaints/${complaint.id}`, null, agentToken);
  assert(detailRes.body.data.messages.length >= 2, 'Thread contains customer message and staff reply');
  assert(detailRes.body.data.status === 'in_progress', 'Ticket status auto-advanced to in_progress on staff reply');

  // Agent closes the ticket
  const closeRes = await apiCall('PATCH', `/api/complaints/${complaint.id}/status`, {
    status: 'closed'
  }, agentToken);

  assert(closeRes.status === 200, 'Agent updated status to closed');
  assert(closeRes.body.data.closed_at !== null, 'closed_at timestamp recorded');

  // Final Dashboard check
  const finalDash = await apiCall('GET', '/api/dashboard/stats', null, ownerToken);
  assert(finalDash.body.data.complaints.closed === 1, 'Closed complaints = 1');
  assert(finalDash.body.data.complaints.pending === 0, 'Pending complaints = 0');
  assert(finalDash.body.data.complaints.resolution_rate_percent === 100, '100% resolution rate');

  console.log('\n======================================================');
  console.log(`🎉 ALL ${passedChecks} CHECKS PASSED SUCCESSFULLY!`);
  console.log('======================================================\n');
  process.exit(0);
}

runTests().catch(err => {
  console.error('Unhandled test failure:', err);
  process.exit(1);
});
