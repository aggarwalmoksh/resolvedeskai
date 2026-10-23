import crypto from 'crypto';
import { supabase } from './supabase.js';

export const PLANS = {
  starter: { id: 'starter', name: 'Starter Plan', price: 19, max_bots: 1, max_members: 3, description: 'Perfect for small shops starting with Telegram support' },
  growth: { id: 'growth', name: 'Growth Plan', price: 49, max_bots: 3, max_members: 10, description: 'For growing businesses with multiple bots and staff' },
  scale: { id: 'scale', name: 'Scale Plan', price: 99, max_bots: 10, max_members: 30, description: 'High-volume businesses needing advanced delegation' },
  enterprise: { id: 'enterprise', name: 'Enterprise Plan', price: 199, max_bots: 50, max_members: 100, description: 'Custom scale for large operations' }
};

export const DEFAULT_PERMISSIONS = {
  owner: {
    can_reply: true,
    can_update_status: true,
    can_assign: true,
    can_manage_team: true,
    can_manage_bots: true
  },
  admin: {
    can_reply: true,
    can_update_status: true,
    can_assign: true,
    can_manage_team: true,
    can_manage_bots: true
  },
  agent: {
    can_reply: true,
    can_update_status: true,
    can_assign: false,
    can_manage_team: false,
    can_manage_bots: false
  }
};

class SupabaseStore {
  constructor() {
    this.isLoaded = true;
  }

  // --- Organizations ---
  async createOrg({ name, phone, subscription_tier = 'starter' }) {
    const plan = PLANS[subscription_tier] || PLANS.starter;
    const { data, error } = await supabase
      .from('organizations')
      .insert({
        name,
        phone,
        subscription_tier: plan.id,
        max_bots: plan.max_bots,
        max_members: plan.max_members,
        ticket_seq: 1000
      })
      .select()
      .single();

    if (error) throw new Error(Supabase createOrg error: );
    return data;
  }

  async getOrgById(id) {
    if (!id) return null;
    const { data, error } = await supabase
      .from('organizations')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (error) {
      console.error(getOrgById error:, error.message);
      return null;
    }
    return data;
  }

  async updateOrg(id, updates) {
    const { data, error } = await supabase
      .from('organizations')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .maybeSingle();

    if (error) throw new Error(Supabase updateOrg error: );
    return data;
  }

  // --- Users ---
  async createUser({ org_id, name, phone, password_hash, role = 'agent', permissions = null }) {
    const perms = permissions || DEFAULT_PERMISSIONS[role] || DEFAULT_PERMISSIONS.agent;
    const { data, error } = await supabase
      .from('users')
      .insert({
        org_id,
        name,
        phone,
        password_hash: password_hash || null,
        role,
        permissions: perms,
        is_active: true
      })
      .select()
      .single();

    if (error) throw new Error(Supabase createUser error: );
    return data;
  }

  async getUserById(id) {
    if (!id) return null;
    const { data, error } = await supabase
      .from('users')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (error) {
      console.error(getUserById error:, error.message);
      return null;
    }
    return data;
  }

  async getUserByPhone(phone, orgId = null) {
    if (!phone) return null;
    let query = supabase.from('users').select('*').eq('phone', phone);
    if (orgId) {
      query = query.eq('org_id', orgId);
    }
    const { data, error } = await query.maybeSingle();
    if (error) {
      console.error(getUserByPhone error:, error.message);
      return null;
    }
    return data;
  }

  async getUsersByOrg(orgId) {
    if (!orgId) return [];
    const { data, error } = await supabase
      .from('users')
      .select('*')
      .eq('org_id', orgId)
      .eq('is_active', true);

    if (error) {
      console.error(getUsersByOrg error:, error.message);
      return [];
    }
    return data || [];
  }

  async updateUser(id, updates) {
    const { data, error } = await supabase
      .from('users')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .maybeSingle();

    if (error) throw new Error(Supabase updateUser error: );
    return data;
  }

  async deleteUser(id) {
    const { error } = await supabase
      .from('users')
      .delete()
      .eq('id', id);

    if (error) {
      console.error(deleteUser error:, error.message);
      return false;
    }
    return true;
  }

  // --- Bots ---
  async createBot({ org_id, bot_token, bot_username, bot_title, secret_token, webhook_url }) {
    const { data, error } = await supabase
      .from('bots')
      .insert({
        org_id,
        bot_token,
        bot_username,
        bot_title: bot_title || bot_username,
        secret_token,
        webhook_url,
        status: 'active'
      })
      .select()
      .single();

    if (error) throw new Error(Supabase createBot error: );
    return data;
  }

  async getBotById(id) {
    if (!id) return null;
    const { data, error } = await supabase
      .from('bots')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (error) {
      console.error(getBotById error:, error.message);
      return null;
    }
    return data;
  }

  async getBotByToken(token) {
    if (!token) return null;
    const { data, error } = await supabase
      .from('bots')
      .select('*')
      .eq('bot_token', token)
      .maybeSingle();

    if (error) {
      console.error(getBotByToken error:, error.message);
      return null;
    }
    return data;
  }

  async getBotsByOrg(orgId) {
    if (!orgId) return [];
    const { data, error } = await supabase
      .from('bots')
      .select('*')
      .eq('org_id', orgId);

    if (error) {
      console.error(getBotsByOrg error:, error.message);
      return [];
    }
    return data || [];
  }

  async updateBot(id, updates) {
    const { data, error } = await supabase
      .from('bots')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .maybeSingle();

    if (error) throw new Error(Supabase updateBot error: );
    return data;
  }

  async deleteBot(id) {
    const { error } = await supabase
      .from('bots')
      .delete()
      .eq('id', id);

    if (error) {
      console.error(deleteBot error:, error.message);
      return false;
    }
    return true;
  }

  // --- Customers ---
  async getOrCreateCustomer({ org_id, telegram_user_id, username, first_name, last_name, phone }) {
    // Check existing
    const { data: existing } = await supabase
      .from('customers')
      .select('*')
      .eq('org_id', org_id)
      .eq('telegram_user_id', Number(telegram_user_id))
      .maybeSingle();

    if (existing) {
      if (username || first_name || last_name || phone) {
        const { data: updated } = await supabase
          .from('customers')
          .update({
            username: username || existing.username,
            first_name: first_name || existing.first_name,
            last_name: last_name || existing.last_name,
            phone: phone || existing.phone,
            updated_at: new Date().toISOString()
          })
          .eq('id', existing.id)
          .select()
          .single();
        return updated || existing;
      }
      return existing;
    }

    const { data, error } = await supabase
      .from('customers')
      .insert({
        org_id,
        telegram_user_id: Number(telegram_user_id),
        username: username || null,
        first_name: first_name || null,
        last_name: last_name || null,
        phone: phone || null
      })
      .select()
      .single();

    if (error) throw new Error(Supabase getOrCreateCustomer error: );
    return data;
  }

  async getCustomerById(id) {
    if (!id) return null;
    const { data, error } = await supabase
      .from('customers')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (error) {
      console.error(getCustomerById error:, error.message);
      return null;
    }
    return data;
  }

  // --- Complaints ---
  async getNextTicketNumber(orgId) {
    const org = await this.getOrgById(orgId);
    let nextSeq = 1001;
    if (org && org.ticket_seq) {
      nextSeq = org.ticket_seq + 1;
      await this.updateOrg(orgId, { ticket_seq: nextSeq });
    } else {
      nextSeq = Math.floor(1000 + Math.random() * 9000);
    }
    return #TICK-;
  }

  async createComplaint({ org_id, bot_id, customer_id, title, description, category = 'other', priority = 'medium' }) {
    const ticketNumber = await this.getNextTicketNumber(org_id);
    const { data, error } = await supabase
      .from('complaints')
      .insert({
        org_id,
        bot_id,
        customer_id,
        ticket_number: ticketNumber,
        title: title || 'Customer Complaint',
        description,
        category,
        priority,
        status: 'pending'
      })
      .select('*, customers(*), bots(*)')
      .single();

    if (error) throw new Error(Supabase createComplaint error: );
    return data;
  }

  async getActiveComplaintForCustomer(orgId, customerId) {
    const { data, error } = await supabase
      .from('complaints')
      .select('*')
      .eq('org_id', orgId)
      .eq('customer_id', customerId)
      .neq('status', 'closed')
      .neq('status', 'resolved')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error(getActiveComplaintForCustomer error:, error.message);
      return null;
    }
    return data;
  }

  async getComplaintById(id, orgId = null) {
    if (!id) return null;
    let query = supabase.from('complaints').select('*, customers(*), bots(*), users(*)').eq('id', id);
    if (orgId) {
      query = query.eq('org_id', orgId);
    }
    const { data, error } = await query.maybeSingle();
    if (error) {
      console.error(getComplaintById error:, error.message);
      return null;
    }
    return data;
  }

  async getComplaints(orgId, filters = {}) {
    let query = supabase
      .from('complaints')
      .select('*, customers(*), bots(*), users(*)')
      .eq('org_id', orgId)
      .order('updated_at', { ascending: false });

    if (filters.status) {
      query = query.eq('status', filters.status);
    }
    if (filters.category) {
      query = query.eq('category', filters.category);
    }
    if (filters.assigned_to) {
      query = query.eq('assigned_to', filters.assigned_to);
    }
    if (filters.bot_id) {
      query = query.eq('bot_id', filters.bot_id);
    }
    if (filters.search) {
      query = query.or(	icket_number.ilike.%%,title.ilike.%%,description.ilike.%%);
    }

    const { data, error } = await query;
    if (error) {
      console.error(getComplaints error:, error.message);
      return [];
    }
    return data || [];
  }

  async updateComplaint(id, updates, orgId = null) {
    const fieldsToUpdate = { ...updates, updated_at: new Date().toISOString() };
    if (updates.status && (updates.status === 'closed' || updates.status === 'resolved')) {
      fieldsToUpdate.closed_at = new Date().toISOString();
    } else if (updates.status && (updates.status === 'pending' || updates.status === 'in_progress')) {
      fieldsToUpdate.closed_at = null;
    }

    let query = supabase.from('complaints').update(fieldsToUpdate).eq('id', id);
    if (orgId) {
      query = query.eq('org_id', orgId);
    }
    const { data, error } = await query.select('*, customers(*), bots(*), users(*)').maybeSingle();
    if (error) throw new Error(Supabase updateComplaint error: );
    return data;
  }

  // --- Complaint Messages ---
  async addMessage({ complaint_id, sender_type, sender_id, sender_name, message_text, telegram_message_id = null }) {
    const { data, error } = await supabase
      .from('complaint_messages')
      .insert({
        complaint_id,
        sender_type,
        sender_id: String(sender_id),
        sender_name: sender_name || null,
        message_text,
        telegram_message_id
      })
      .select()
      .single();

    if (error) throw new Error(Supabase addMessage error: );
    return data;
  }

  async getMessagesByComplaint(complaintId) {
    const { data, error } = await supabase
      .from('complaint_messages')
      .select('*')
      .eq('complaint_id', complaintId)
      .order('created_at', { ascending: true });

    if (error) {
      console.error(getMessagesByComplaint error:, error.message);
      return [];
    }
    return data || [];
  }

  // --- Invitations ---
  async createInvitation({ org_id, phone, role = 'agent', permissions }) {
    const perms = permissions || DEFAULT_PERMISSIONS[role] || DEFAULT_PERMISSIONS.agent;
    const inviteCode = INV-;
    const { data, error } = await supabase
      .from('invitations')
      .insert({
        org_id,
        phone,
        role,
        permissions: perms,
        invite_code: inviteCode,
        status: 'pending'
      })
      .select()
      .single();

    if (error) throw new Error(Supabase createInvitation error: );
    return data;
  }

  async getInvitationByCode(code) {
    const { data, error } = await supabase
      .from('invitations')
      .select('*')
      .eq('invite_code', code)
      .eq('status', 'pending')
      .maybeSingle();

    if (error) {
      console.error(getInvitationByCode error:, error.message);
      return null;
    }
    return data;
  }

  async getInvitationsByOrg(orgId) {
    const { data, error } = await supabase
      .from('invitations')
      .select('*')
      .eq('org_id', orgId)
      .eq('status', 'pending');

    if (error) {
      console.error(getInvitationsByOrg error:, error.message);
      return [];
    }
    return data || [];
  }

  async updateInvitation(id, updates) {
    const { data, error } = await supabase
      .from('invitations')
      .update(updates)
      .eq('id', id)
      .select()
      .maybeSingle();

    if (error) throw new Error(Supabase updateInvitation error: );
    return data;
  }
}

export const store = new SupabaseStore();
