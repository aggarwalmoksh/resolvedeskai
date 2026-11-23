import crypto from 'crypto';
import { fingerprintToken, protectBotToken } from '../services/botSecrets.js';
import { supabase } from './supabase.js';

import { PLAN_CATALOG } from '../../../shared/plans.js';

const [starter, growth] = PLAN_CATALOG;
export const PLANS = {
  starter,
  growth,
  scale: { id: 'scale', name: 'Business', currency: '₹', price_monthly: 999, max_bots: 10, max_members: 25 },
  enterprise: { id: 'enterprise', name: 'Business', currency: '₹', price_monthly: 999, max_bots: 10, max_members: 25 },
};

export const DEFAULT_PERMISSIONS = {
  owner: { can_reply: true, can_update_status: true, can_assign: true, can_manage_team: true, can_manage_bots: true, can_view_analytics: true },
  admin: { can_reply: true, can_update_status: true, can_assign: true, can_manage_team: true, can_manage_bots: true, can_view_analytics: true },
  agent: { can_reply: true, can_update_status: true, can_assign: false, can_manage_team: false, can_manage_bots: false, can_view_analytics: true }
};

function db() {
  if (!supabase) throw new Error('Database is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
  return supabase;
}
function forTicketParticipant(query, userId) {
  return query.or(`assigned_to.eq.${userId},collaborator_ids.cs.{${userId}}`);
}

function checked(error, operation) { if (error) throw Object.assign(new Error(`${operation}: ${error.message}`), { code: error.code }); }

class SupabaseStore {
  async createOrg({ name, phone = null, subscription_tier = 'starter' }) { const plan = PLANS[subscription_tier] || PLANS.starter; const { data, error } = await db().from('organizations').insert({ name, phone, subscription_tier: plan.id, max_bots: plan.max_bots, max_members: plan.max_members }).select().single(); checked(error, 'Could not create organization'); return data; }
  async getOrgById(id) { if (!id) return null; const { data, error } = await db().from('organizations').select('*').eq('id', id).maybeSingle(); checked(error, 'Could not load organization'); return data; }
  async updateOrg(id, updates) { const { data, error } = await db().from('organizations').update({ ...updates, updated_at: new Date().toISOString() }).eq('id', id).select().maybeSingle(); checked(error, 'Could not update organization'); return data; }

  async createUser({ clerk_user_id, org_id, name, email = null, phone = null, role = 'agent', permissions }) { const { data, error } = await db().from('users').insert({ clerk_user_id, org_id, name, email: email?.toLowerCase() || null, phone, role, permissions: permissions || DEFAULT_PERMISSIONS[role] || DEFAULT_PERMISSIONS.agent, is_active: true }).select().single(); checked(error, 'Could not create member'); return data; }
  async getUserById(id, orgId) { if (!id) return null; const { data, error } = await db().from('users').select('*').eq('id', id).eq('org_id', orgId).maybeSingle(); checked(error, 'Could not load member'); return data; }
  async getUserByClerkId(clerkId) { if (!clerkId) return null; const { data, error } = await db().from('users').select('*').eq('clerk_user_id', clerkId).maybeSingle(); checked(error, 'Could not load member'); return data; }
  async getUserByEmail(email, orgId = null) { if (!email) return null; let query = db().from('users').select('*').eq('email', email.toLowerCase()); if (orgId) query = query.eq('org_id', orgId); const { data, error } = await query.maybeSingle(); checked(error, 'Could not load member'); return data; }
  async getUsersByOrg(orgId) { const { data, error } = await db().from('users').select('*').eq('org_id', orgId).eq('is_active', true).order('created_at'); checked(error, 'Could not load members'); return data || []; }
  async updateUser(id, orgId, updates) { const { data, error } = await db().from('users').update({ ...updates, updated_at: new Date().toISOString() }).eq('id', id).eq('org_id', orgId).select().maybeSingle(); checked(error, 'Could not update member'); return data; }
  async deleteUser(id, orgId) {
    if (!id) return false;
    const user = await this.getUserById(id, orgId);
    if (user?.org_id && user?.email) {
      try {
        await db().from('invitations').delete().eq('org_id', user.org_id).eq('email', user.email.toLowerCase());
      } catch {}
    }
    await db().from('complaints').update({ assigned_to: null }).eq('assigned_to', id).eq('org_id', orgId);
    const { error } = await db().from('users').delete().eq('id', id).eq('org_id', orgId);
    checked(error, 'Could not remove member from Supabase');
    return true;
  }

  async getBotsByOrg(orgId, { includeCredentials = false } = {}) {
    const columns = 'id, org_id, bot_username, bot_title, masked_token, webhook_url, status, created_at';
    const projection = includeCredentials ? `${columns}, bot_token, secret_token` : columns;
    const { data, error } = await db().from('bots').select(projection).eq('org_id', orgId)
      .order('created_at').order('id');
    checked(error, 'Could not load bots');
    return data || [];
  }
  async getBotById(id, orgId) { const { data, error } = await db().from('bots').select('*').eq('id', id).eq('org_id', orgId).maybeSingle(); checked(error, 'Could not load bot'); return data; }
  async getWebhookBot(id) {
    const { data, error } = await db().from('bots').select('id, org_id, secret_token, status').eq('id', id).maybeSingle();
    checked(error, 'Could not load webhook configuration');
    return data;
  }
  async getBotByToken(token) { const { data, error } = await db().from('bots').select('*').eq('bot_token_fingerprint', fingerprintToken(token)).maybeSingle(); checked(error, 'Could not load bot'); return data; }
  async createBot({ bot_token, ...values }) { const { data, error } = await db().from('bots').insert({ ...values, ...protectBotToken(bot_token, values), status: 'active' }).select().single(); checked(error, 'Could not link bot'); return data; }
  async updateBot(id, orgId, updates) { const { data, error } = await db().from('bots').update({ ...updates, updated_at: new Date().toISOString() }).eq('id', id).eq('org_id', orgId).select().maybeSingle(); checked(error, 'Could not update bot'); return data; }
  async deleteBot(id, orgId) { const { error } = await db().from('bots').delete().eq('id', id).eq('org_id', orgId); checked(error, 'Could not unlink bot'); return true; }

  async getCustomerById(id, orgId) { const { data, error } = await db().from('customers').select('*').eq('id', id).eq('org_id', orgId).maybeSingle(); checked(error, 'Could not load customer'); return data; }
  async getComplaints(orgId, filters = {}) { let query = db().from('complaints').select('*, customers!complaints_customer_id_fkey(id, first_name, last_name, username, phone, telegram_user_id), bots!complaints_bot_id_fkey(id, bot_username, bot_title), assignee:users!complaints_assigned_to_fkey(id, name, role)').eq('org_id', orgId).eq('isolation_review_required', false).order('updated_at', { ascending: false }); if (filters.participant_id) query = forTicketParticipant(query, filters.participant_id); for (const key of ['status', 'category', 'assigned_to', 'bot_id']) if (filters[key]) query = query.eq(key, filters[key]); if (filters.search) { const term = JSON.stringify(`%${String(filters.search).slice(0, 200)}%`); query = query.or(`ticket_number.ilike.${term},title.ilike.${term},description.ilike.${term}`); } const { data, error } = await query; checked(error, 'Could not load complaints'); return data || []; }
  async getComplaintById(id, orgId, assignedTo) { let query = db().from('complaints').select('*, customers!complaints_customer_id_fkey(id, first_name, last_name, username, phone, telegram_user_id), bots!complaints_bot_id_fkey(id, bot_username, bot_title), assignee:users!complaints_assigned_to_fkey(id, name, role)').eq('id', id); query = query.eq('org_id', orgId).eq('isolation_review_required', false); if (assignedTo) query = forTicketParticipant(query, assignedTo); const { data, error } = await query.maybeSingle(); checked(error, 'Could not load complaint'); return data; }
  async updateComplaint(id, updates, orgId, assignedTo, previous) { let query = db().from('complaints').update({ ...updates, updated_at: new Date().toISOString(), ...(updates.status && ['closed', 'resolved'].includes(updates.status) ? { closed_at: new Date().toISOString() } : {}) }).eq('id', id); query = query.eq('org_id', orgId).eq('isolation_review_required', false); if (assignedTo) query = forTicketParticipant(query, assignedTo); if (previous) {
      query = previous.assigned_to ? query.eq('assigned_to', previous.assigned_to) : query.is('assigned_to', null);
      query = query.eq('collaborator_ids', `{${(previous.collaborator_ids || []).join(',')}}`);
    }
    const { data, error } = await query.select().maybeSingle(); checked(error, 'Could not update complaint'); return data; }
  async addMessage(values) { const { data, error } = await db().from('complaint_messages').insert({ ...values, sender_id: String(values.sender_id) }).select().single(); checked(error, 'Could not save message'); return data; }
  async getMessagesByComplaint(id, orgId) { const { data, error } = await db().from('complaint_messages').select('*').eq('complaint_id', id).eq('org_id', orgId).order('created_at'); checked(error, 'Could not load messages'); return data || []; }

  async enqueueTelegramUpdate(bot, updateId, payload) {
    const { error } = await db().from('telegram_update_inbox').upsert({
      bot_id: bot.id, org_id: bot.org_id, update_id: updateId, payload,
    }, { onConflict: 'bot_id,update_id', ignoreDuplicates: true });
    checked(error, 'Could not queue Telegram update');
  }

  async processTelegramUpdate() {
    const { data, error } = await db().rpc('process_telegram_update').abortSignal(AbortSignal.timeout(10_000));
    checked(error, 'Could not process Telegram update');
    return data;
  }

  async getWorkspaceRevision(orgId) {
    const { data, error } = await db().from('workspace_revisions').select('revision').eq('org_id', orgId).maybeSingle();
    checked(error, 'Could not read workspace revision');
    return String(data?.revision ?? 0);
  }

  async createInvitation({ org_id, email, role = 'agent', permissions, clerk_invitation_id = null }) { const invite_code = `INV-${crypto.randomBytes(12).toString('hex').toUpperCase()}`; const { data, error } = await db().from('invitations').insert({ org_id, email: email?.toLowerCase(), role, permissions: permissions || DEFAULT_PERMISSIONS[role] || DEFAULT_PERMISSIONS.agent, invite_code, clerk_invitation_id }).select().single(); checked(error, 'Could not create invitation'); return data; }
  async getInvitationByCode(code) { const { data, error } = await db().from('invitations').select('*').eq('invite_code', code).eq('status', 'pending').gt('expires_at', new Date().toISOString()).maybeSingle(); checked(error, 'Could not load invitation'); return data; }
  async getPendingInvitationsForEmail(email) {
    const { data, error } = await db().from('invitations').select('invite_code, org_id, role, organizations(name)')
      .eq('email', email).eq('status', 'pending').gt('expires_at', new Date().toISOString()).order('created_at');
    checked(error, 'Could not load pending invitations');
    return data || [];
  }
  async getInvitationsByOrg(orgId) { const { data, error } = await db().from('invitations').select('*').eq('org_id', orgId).eq('status', 'pending').gt('expires_at', new Date().toISOString()).order('created_at'); checked(error, 'Could not load invitations'); return data || []; }
  async transitionInvitation(id, orgId, expectedStatus, updates) {
    let query = db().from('invitations').update(updates)
      .eq('id', id).eq('org_id', orgId).eq('status', expectedStatus);
    if (updates.status === 'accepting') query = query.gt('expires_at', new Date().toISOString());
    const { data, error } = await query.select().maybeSingle();
    checked(error, 'Could not update invitation');
    return data;
  }
  async updateInvitation(id, orgId, updates) { const { data, error } = await db().from('invitations').update(updates).eq('id', id).eq('org_id', orgId).select().maybeSingle(); checked(error, 'Could not update invitation'); return data; }
}

export const store = new SupabaseStore();
