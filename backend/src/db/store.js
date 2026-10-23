import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, '../../.data');
const DB_FILE = path.resolve(DATA_DIR, 'db.json');
import { supabase } from './supabase.js';

// Subscription plan definitions
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

class Store {
  constructor() {
    this.data = {
      organizations: [],
      users: [],
      bots: [],
      customers: [],
      complaints: [],
      complaint_messages: [],
      invitations: []
    };
    this.isLoaded = false;
    this.load();
  }

  load() {
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }

      if (fs.existsSync(DB_FILE)) {
        const raw = fs.readFileSync(DB_FILE, 'utf-8');
        this.data = { ...this.data, ...JSON.parse(raw) };
      } else {
        this.save();
      }
      this.isLoaded = true;
    } catch (err) {
      console.warn('⚠️ Warning: Failed to read local db.json, using in-memory store:', err.message);
      this.isLoaded = true;
    }
  }

  save() {
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }
      fs.writeFileSync(DB_FILE, JSON.stringify(this.data, null, 2), 'utf-8');
    } catch (err) {
      console.error('❌ Failed to persist store to file:', err.message);
    }
  }

  // Generic collection helper
  _coll(name) {
    if (!this.data[name]) this.data[name] = [];
    return this.data[name];
  }

  // Organizations
  createOrg({ id = null, name, phone, subscription_tier = 'starter' }) {
    const plan = PLANS[subscription_tier] || PLANS.starter;
    const org = {
      id: id || crypto.randomUUID(),
      name,
      phone,
      subscription_tier: plan.id,
      max_bots: plan.max_bots,
      max_members: plan.max_members,
      ticket_seq: 1000,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    this._coll('organizations').push(org);
    this.save();

    // Sync to Supabase PostgreSQL table
    if (supabase) {
      supabase.from('organizations').insert({
        id: org.id,
        name: org.name,
        phone: org.phone,
        subscription_tier: org.subscription_tier,
        max_bots: org.max_bots,
        max_members: org.max_members,
        ticket_seq: org.ticket_seq,
        created_at: org.created_at,
        updated_at: org.updated_at
      }).then(({ error }) => {
        if (error) console.warn('⚠️ Supabase organizations sync note:', error.message);
        else console.log('⚡ [Supabase] Org synchronized:', org.name);
      }).catch(err => console.warn('Supabase org sync err:', err.message));
    }

    return org;
  }

  getOrgById(id) {
    return this._coll('organizations').find(o => o.id === id) || null;
  }

  updateOrg(id, updates) {
    const org = this.getOrgById(id);
    if (!org) return null;
    Object.assign(org, updates, { updated_at: new Date().toISOString() });
    this.save();

    if (supabase) {
      supabase.from('organizations').update({ ...updates, updated_at: org.updated_at }).eq('id', id)
        .then(({ error }) => { if (error) console.warn('Supabase org update note:', error.message); })
        .catch(err => console.warn('Supabase org update err:', err.message));
    }
    return org;
  }

  // Users
  createUser({ id = null, org_id, name, phone, password_hash, role = 'agent', permissions = null }) {
    const perms = permissions || DEFAULT_PERMISSIONS[role] || DEFAULT_PERMISSIONS.agent;
    const user = {
      id: id || crypto.randomUUID(),
      org_id,
      name,
      phone,
      password_hash: password_hash || null,
      role,
      permissions: { ...perms },
      is_active: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    this._coll('users').push(user);
    this.save();

    if (supabase) {
      supabase.from('users').insert({
        id: user.id,
        org_id: user.org_id,
        name: user.name,
        phone: user.phone,
        password_hash: user.password_hash,
        role: user.role,
        permissions: user.permissions,
        is_active: user.is_active,
        created_at: user.created_at,
        updated_at: user.updated_at
      }).then(({ error }) => {
        if (error) console.warn('⚠️ Supabase users sync note:', error.message);
        else console.log('⚡ [Supabase] User synchronized:', user.phone);
      }).catch(err => console.warn('Supabase user sync err:', err.message));
    }

    return user;
  }

  getUserById(id) {
    return this._coll('users').find(u => u.id === id) || null;
  }

  getUserByPhone(phone, orgId = null) {
    return this._coll('users').find(u => u.phone === phone && (!orgId || u.org_id === orgId)) || null;
  }

  getUsersByOrg(orgId) {
    return this._coll('users').filter(u => u.org_id === orgId && u.is_active);
  }

  updateUser(id, updates) {
    const user = this.getUserById(id);
    if (!user) return null;
    Object.assign(user, updates, { updated_at: new Date().toISOString() });
    this.save();

    if (supabase) {
      supabase.from('users').update({ ...updates, updated_at: user.updated_at }).eq('id', id)
        .then(({ error }) => { if (error) console.warn('Supabase user update note:', error.message); })
        .catch(err => console.warn('Supabase user update err:', err.message));
    }
    return user;
  }

  deleteUser(id) {
    const idx = this._coll('users').findIndex(u => u.id === id);
    if (idx !== -1) {
      this._coll('users').splice(idx, 1);
      this.save();

      if (supabase) {
        supabase.from('users').delete().eq('id', id)
          .then(({ error }) => { if (error) console.warn('Supabase user delete note:', error.message); })
          .catch(err => console.warn('Supabase user delete err:', err.message));
      }
      return true;
    }
    return false;
  }

  // Bots
  createBot({ id = null, org_id, bot_token, bot_username, bot_title, secret_token, webhook_url }) {
    const bot = {
      id: id || crypto.randomUUID(),
      org_id,
      bot_token,
      bot_username,
      bot_title: bot_title || bot_username,
      secret_token,
      webhook_url,
      status: 'active',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    this._coll('bots').push(bot);
    this.save();

    if (supabase) {
      supabase.from('bots').insert({
        id: bot.id,
        org_id: bot.org_id,
        bot_token: bot.bot_token,
        bot_username: bot.bot_username,
        bot_title: bot.bot_title,
        secret_token: bot.secret_token,
        webhook_url: bot.webhook_url,
        status: bot.status,
        created_at: bot.created_at,
        updated_at: bot.updated_at
      }).then(({ error }) => {
        if (error) console.warn('⚠️ Supabase bots sync note:', error.message);
        else console.log('⚡ [Supabase] Bot synchronized:', bot.bot_username);
      }).catch(err => console.warn('Supabase bot sync err:', err.message));
    }

    return bot;
  }

  getBotById(id) {
    return this._coll('bots').find(b => b.id === id) || null;
  }

  getBotByToken(token) {
    return this._coll('bots').find(b => b.bot_token === token) || null;
  }

  getBotsByOrg(orgId) {
    return this._coll('bots').filter(b => b.org_id === orgId);
  }

  updateBot(id, updates) {
    const bot = this.getBotById(id);
    if (!bot) return null;
    Object.assign(bot, updates, { updated_at: new Date().toISOString() });
    this.save();

    if (supabase) {
      supabase.from('bots').update({ ...updates, updated_at: bot.updated_at }).eq('id', id)
        .then(({ error }) => { if (error) console.warn('Supabase bot update note:', error.message); })
        .catch(err => console.warn('Supabase bot update err:', err.message));
    }
    return bot;
  }

  deleteBot(id) {
    const idx = this._coll('bots').findIndex(b => b.id === id);
    if (idx !== -1) {
      this._coll('bots').splice(idx, 1);
      this.save();

      if (supabase) {
        supabase.from('bots').delete().eq('id', id)
          .then(({ error }) => { if (error) console.warn('Supabase bot delete note:', error.message); })
          .catch(err => console.warn('Supabase bot delete err:', err.message));
      }
      return true;
    }
    return false;
  }

  // Customers
  getOrCreateCustomer({ org_id, telegram_user_id, username, first_name, last_name, phone }) {
    let customer = this._coll('customers').find(c => c.org_id === org_id && String(c.telegram_user_id) === String(telegram_user_id));
    if (!customer) {
      customer = {
        id: crypto.randomUUID(),
        org_id,
        telegram_user_id: Number(telegram_user_id),
        username: username || null,
        first_name: first_name || null,
        last_name: last_name || null,
        phone: phone || null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
      this._coll('customers').push(customer);
      this.save();

      if (supabase) {
        supabase.from('customers').insert({
          id: customer.id,
          org_id: customer.org_id,
          telegram_user_id: customer.telegram_user_id,
          username: customer.username,
          first_name: customer.first_name,
          last_name: customer.last_name,
          phone: customer.phone,
          created_at: customer.created_at,
          updated_at: customer.updated_at
        }).then(({ error }) => {
          if (error) console.warn('⚠️ Supabase customers sync note:', error.message);
          else console.log('⚡ [Supabase] Customer synchronized:', customer.telegram_user_id);
        }).catch(err => console.warn('Supabase customer sync err:', err.message));
      }
    } else {
      // update details if changed
      if (username || first_name || last_name || phone) {
        Object.assign(customer, {
          username: username || customer.username,
          first_name: first_name || customer.first_name,
          last_name: last_name || customer.last_name,
          phone: phone || customer.phone,
          updated_at: new Date().toISOString()
        });
        this.save();

        if (supabase) {
          supabase.from('customers').update({
            username: customer.username,
            first_name: customer.first_name,
            last_name: customer.last_name,
            phone: customer.phone,
            updated_at: customer.updated_at
          }).eq('id', customer.id)
            .then(({ error }) => { if (error) console.warn('Supabase customer update note:', error.message); })
            .catch(err => console.warn('Supabase customer update err:', err.message));
        }
      }
    }
    return customer;
  }

  getCustomerById(id) {
    return this._coll('customers').find(c => c.id === id) || null;
  }

  // Complaints / Tickets
  getNextTicketNumber(orgId) {
    const org = this.getOrgById(orgId);
    const seq = org ? ++org.ticket_seq : Math.floor(1000 + Math.random() * 9000);
    this.save();
    return `#TICK-${seq}`;
  }

  createComplaint({ org_id, bot_id, customer_id, title, description, category = 'other', priority = 'medium' }) {
    const ticketNumber = this.getNextTicketNumber(org_id);
    const complaint = {
      id: crypto.randomUUID(),
      org_id,
      bot_id,
      customer_id,
      ticket_number: ticketNumber,
      title: title || 'Customer Complaint',
      description,
      category,
      priority,
      status: 'pending', // pending, in_progress, resolved, closed
      assigned_to: null,
      closed_at: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    this._coll('complaints').push(complaint);
    this.save();

    if (supabase) {
      supabase.from('complaints').insert({
        id: complaint.id,
        org_id: complaint.org_id,
        bot_id: complaint.bot_id,
        customer_id: complaint.customer_id,
        ticket_number: complaint.ticket_number,
        title: complaint.title,
        description: complaint.description,
        category: complaint.category,
        priority: complaint.priority,
        status: complaint.status,
        created_at: complaint.created_at,
        updated_at: complaint.updated_at
      }).then(({ error }) => {
        if (error) console.warn('⚠️ Supabase complaints sync note:', error.message);
        else console.log('⚡ [Supabase] Complaint ticket synchronized:', complaint.ticket_number);
      }).catch(err => console.warn('Supabase complaint sync err:', err.message));
    }

    return complaint;
  }

  getActiveComplaintForCustomer(orgId, customerId) {
    return this._coll('complaints').find(c => 
      c.org_id === orgId && 
      c.customer_id === customerId && 
      c.status !== 'closed' && 
      c.status !== 'resolved'
    ) || null;
  }

  getComplaintById(id, orgId = null) {
    return this._coll('complaints').find(c => c.id === id && (!orgId || c.org_id === orgId)) || null;
  }

  getComplaints(orgId, filters = {}) {
    let list = this._coll('complaints').filter(c => c.org_id === orgId);

    if (filters.status) {
      list = list.filter(c => c.status === filters.status);
    }
    if (filters.category) {
      list = list.filter(c => c.category === filters.category);
    }
    if (filters.assigned_to) {
      list = list.filter(c => c.assigned_to === filters.assigned_to);
    }
    if (filters.bot_id) {
      list = list.filter(c => c.bot_id === filters.bot_id);
    }
    if (filters.search) {
      const q = filters.search.toLowerCase();
      list = list.filter(c => 
        c.ticket_number.toLowerCase().includes(q) || 
        c.title.toLowerCase().includes(q) || 
        c.description.toLowerCase().includes(q)
      );
    }

    return list.sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));
  }

  updateComplaint(id, updates, orgId = null) {
    const complaint = this.getComplaintById(id, orgId);
    if (!complaint) return null;
    
    if (updates.status && (updates.status === 'closed' || updates.status === 'resolved') && !complaint.closed_at) {
      updates.closed_at = new Date().toISOString();
    } else if (updates.status && (updates.status === 'pending' || updates.status === 'in_progress')) {
      updates.closed_at = null;
    }

    Object.assign(complaint, updates, { updated_at: new Date().toISOString() });
    this.save();

    if (supabase) {
      supabase.from('complaints').update({ ...updates, updated_at: complaint.updated_at }).eq('id', id)
        .then(({ error }) => { if (error) console.warn('Supabase complaint update note:', error.message); })
        .catch(err => console.warn('Supabase complaint update err:', err.message));
    }

    return complaint;
  }

  // Complaint Messages
  addMessage({ complaint_id, sender_type, sender_id, sender_name, message_text, telegram_message_id = null }) {
    const msg = {
      id: crypto.randomUUID(),
      complaint_id,
      sender_type, // 'customer', 'agent', 'system'
      sender_id: String(sender_id),
      sender_name: sender_name || null,
      message_text,
      telegram_message_id,
      created_at: new Date().toISOString()
    };
    this._coll('complaint_messages').push(msg);
    this.save();

    if (supabase) {
      supabase.from('complaint_messages').insert({
        id: msg.id,
        complaint_id: msg.complaint_id,
        sender_type: msg.sender_type,
        sender_id: msg.sender_id,
        sender_name: msg.sender_name,
        message_text: msg.message_text,
        telegram_message_id: msg.telegram_message_id,
        created_at: msg.created_at
      }).then(({ error }) => {
        if (error) console.warn('⚠️ Supabase complaint_messages sync note:', error.message);
        else console.log('⚡ [Supabase] Message synchronized for complaint:', complaint_id);
      }).catch(err => console.warn('Supabase message sync err:', err.message));
    }

    return msg;
  }

  getMessagesByComplaint(complaintId) {
    return this._coll('complaint_messages')
      .filter(m => m.complaint_id === complaintId)
      .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  }

  // Invitations
  createInvitation({ org_id, phone, role = 'agent', permissions }) {
    const invite = {
      id: crypto.randomUUID(),
      org_id,
      phone,
      role,
      permissions: permissions || DEFAULT_PERMISSIONS[role] || DEFAULT_PERMISSIONS.agent,
      invite_code: `INV-${crypto.randomBytes(4).toString('hex').toUpperCase()}`,
      status: 'pending', // pending, accepted, revoked
      created_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
    };
    this._coll('invitations').push(invite);
    this.save();

    if (supabase) {
      supabase.from('invitations').insert({
        id: invite.id,
        org_id: invite.org_id,
        phone: invite.phone,
        role: invite.role,
        permissions: invite.permissions,
        invite_code: invite.invite_code,
        status: invite.status,
        created_at: invite.created_at,
        expires_at: invite.expires_at
      }).then(({ error }) => {
        if (error) console.warn('⚠️ Supabase invitations sync note:', error.message);
        else console.log('⚡ [Supabase] Invitation synchronized:', invite.invite_code);
      }).catch(err => console.warn('Supabase invitation sync err:', err.message));
    }

    return invite;
  }

  getInvitationByCode(code) {
    return this._coll('invitations').find(i => i.invite_code === code && i.status === 'pending') || null;
  }

  getInvitationsByOrg(orgId) {
    return this._coll('invitations').filter(i => i.org_id === orgId && i.status === 'pending');
  }

  updateInvitation(id, updates) {
    const invite = this._coll('invitations').find(i => i.id === id);
    if (!invite) return null;
    Object.assign(invite, updates);
    this.save();

    if (supabase) {
      supabase.from('invitations').update(updates).eq('id', id)
        .then(({ error }) => { if (error) console.warn('Supabase invitation update note:', error.message); })
        .catch(err => console.warn('Supabase invitation update err:', err.message));
    }

    return invite;
  }
}

export const store = new Store();
