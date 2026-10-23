import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, '../../.data');
const DB_FILE = path.resolve(DATA_DIR, 'db.json');

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
  createOrg({ name, phone, subscription_tier = 'starter' }) {
    const plan = PLANS[subscription_tier] || PLANS.starter;
    const org = {
      id: crypto.randomUUID(),
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
    return org;
  }

  // Users
  createUser({ org_id, name, phone, password_hash, role = 'agent', permissions = null }) {
    const perms = permissions || DEFAULT_PERMISSIONS[role] || DEFAULT_PERMISSIONS.agent;
    const user = {
      id: crypto.randomUUID(),
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
    return user;
  }

  deleteUser(id) {
    const idx = this._coll('users').findIndex(u => u.id === id);
    if (idx !== -1) {
      this._coll('users').splice(idx, 1);
      this.save();
      return true;
    }
    return false;
  }

  // Bots
  createBot({ org_id, bot_token, bot_username, bot_title, secret_token, webhook_url }) {
    const bot = {
      id: crypto.randomUUID(),
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
    return bot;
  }

  deleteBot(id) {
    const idx = this._coll('bots').findIndex(b => b.id === id);
    if (idx !== -1) {
      this._coll('bots').splice(idx, 1);
      this.save();
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
    } else {
      // update details if changed
      if (username || first_name || last_name) {
        Object.assign(customer, {
          username: username || customer.username,
          first_name: first_name || customer.first_name,
          last_name: last_name || customer.last_name,
          updated_at: new Date().toISOString()
        });
        this.save();
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

    // Sort by updated_at descending
    return list.sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));
  }

  updateComplaint(id, updates, orgId = null) {
    const complaint = this.getComplaintById(id, orgId);
    if (!complaint) return null;
    
    if (updates.status && (updates.status === 'closed' || updates.status === 'resolved') && !complaint.closed_at) {
      updates.closed_at = new Date().toISOString();
    } else if (updates.status && updates.status === 'pending' || updates.status === 'in_progress') {
      updates.closed_at = null;
    }

    Object.assign(complaint, updates, { updated_at: new Date().toISOString() });
    this.save();
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
    return invite;
  }
}

export const store = new Store();
