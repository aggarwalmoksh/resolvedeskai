import crypto from 'crypto';
import { store, DEFAULT_PERMISSIONS } from '../db/store.js';

const JWT_SECRET = process.env.SECRET_TOKEN || 'resolvedesk_saas_default_secret_key_2026';

// Lightweight built-in token creation & verification using Node.js crypto
export function signToken(payload) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Date.now() + 30 * 24 * 60 * 60 * 1000 })).toString('base64url');
  const signature = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${signature}`;
}

export function verifyToken(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const [header, body, signature] = parts;
  const expectedSig = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest('base64url');

  if (signature !== expectedSig) return null;

  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf-8'));
    if (payload.exp && Date.now() > payload.exp) return null; // expired
    return payload;
  } catch (err) {
    return null;
  }
}

// Built-in secure password hashing with crypto.scryptSync
export function hashPassword(password) {
  if (!password) return null;
  const salt = crypto.randomBytes(16).toString('hex');
  const derivedKey = crypto.scryptSync(password, salt, 64);
  return `${salt}:${derivedKey.toString('hex')}`;
}

export function verifyPassword(password, storedHash) {
  if (!storedHash || !password) return false;
  const [salt, key] = storedHash.split(':');
  if (!salt || !key) return false;
  const keyBuffer = Buffer.from(key, 'hex');
  const derivedBuffer = crypto.scryptSync(password, salt, 64);
  return crypto.timingSafeEqual(keyBuffer, derivedBuffer);
}

import { supabase } from '../db/supabase.js';

// Format phone number to E.164 standard for Supabase Phone Auth
export function formatE164Phone(phone) {
  if (!phone) return phone;
  const digits = phone.replace(/[^0-9+]/g, '');
  if (digits.startsWith('+')) return digits;
  // If 10 digits (e.g. 9876543210), prepend default country code (+91 or +1)
  if (digits.length === 10) return `+91${digits}`;
  return `+${digits}`;
}

// Register Business Owner and create Organization (Supabase Auth Option A)
export async function registerOwner({ name, phone, password, businessName, subscriptionTier = 'starter' }) {
  if (!phone || !name || !businessName) {
    throw new Error('Name, phone, and business name are required');
  }

  const cleanPhone = formatE164Phone(phone.trim());
  const existingUser = store.getUserByPhone(cleanPhone) || store.getUserByPhone(phone.trim());
  if (existingUser) {
    throw new Error('A user with this phone number already exists');
  }

  // 1. Create User in Supabase Auth (auth.users)
  let supabaseAuthUserId = null;
  if (supabase) {
    try {
      const { data: authData, error: authError } = await supabase.auth.admin.createUser({
        phone: cleanPhone,
        password: password || undefined,
        phone_confirm: true,
        user_metadata: {
          name: name.trim(),
          business_name: businessName
        }
      });

      if (authError) {
        console.warn('⚠️ Supabase Auth createUser notice:', authError.message);
      } else if (authData && authData.user) {
        supabaseAuthUserId = authData.user.id;
        console.log('⚡ [Supabase Auth] Created auth.user:', supabaseAuthUserId);
      }
    } catch (err) {
      console.warn('Supabase Auth error:', err.message);
    }
  }

  // 2. Create Organization with specified subscription tier
  const org = store.createOrg({
    name: businessName,
    phone: cleanPhone,
    subscription_tier: subscriptionTier
  });

  // 3. Create Owner User (linked by Supabase UUID if available)
  const passwordHash = password ? hashPassword(password) : null;
  const user = store.createUser({
    id: supabaseAuthUserId,
    org_id: org.id,
    name: name.trim(),
    phone: cleanPhone,
    password_hash: passwordHash,
    role: 'owner',
    permissions: DEFAULT_PERMISSIONS.owner
  });

  const token = signToken({ userId: user.id, orgId: org.id });

  return {
    user: sanitizeUser(user),
    org,
    token
  };
}

// Login User via Phone and Password (with Supabase Auth Option A support)
export async function loginUser({ phone, password }) {
  if (!phone) throw new Error('Phone number is required');

  const cleanPhone = formatE164Phone(phone.trim());
  let user = store.getUserByPhone(cleanPhone) || store.getUserByPhone(phone.trim());

  // Attempt Supabase Native Phone Auth if available
  if (supabase && password) {
    try {
      const { data: authData, error: authErr } = await supabase.auth.signInWithPassword({
        phone: cleanPhone,
        password: password
      });

      if (!authErr && authData?.user) {
        console.log('⚡ [Supabase Auth] Verified login for:', cleanPhone);
        if (!user) {
          user = store.getUserById(authData.user.id);
        }
      }
    } catch (err) {
      // Fall through to store authentication
    }
  }

  if (!user) throw new Error('User not found with this phone number');

  if (user.password_hash) {
    if (!password || !verifyPassword(password, user.password_hash)) {
      throw new Error('Invalid credentials');
    }
  }

  const org = store.getOrgById(user.org_id);
  if (!org) throw new Error('Organization not found');

  const token = signToken({ userId: user.id, orgId: org.id });

  return {
    user: sanitizeUser(user),
    org,
    token
  };
}

// Supabase Native OTP Flow (Send Phone OTP via Supabase Auth)
export async function sendPhoneOtp(phone) {
  const cleanPhone = formatE164Phone(phone.trim());
  if (!supabase) {
    throw new Error('Supabase client not initialized');
  }

  const { data, error } = await supabase.auth.signInWithOtp({
    phone: cleanPhone
  });

  if (error) throw new Error(`Supabase OTP error: ${error.message}`);
  return { status: 'success', message: `OTP sent to ${cleanPhone}`, data };
}

// Supabase Native OTP Flow (Verify Phone OTP)
export async function verifyPhoneOtp(phone, token) {
  const cleanPhone = formatE164Phone(phone.trim());
  if (!supabase) {
    throw new Error('Supabase client not initialized');
  }

  const { data, error } = await supabase.auth.verifyOtp({
    phone: cleanPhone,
    token,
    type: 'sms'
  });

  if (error) throw new Error(`OTP verification failed: ${error.message}`);

  let user = store.getUserByPhone(cleanPhone) || (data.user ? store.getUserById(data.user.id) : null);
  if (!user) {
    throw new Error('No business registered for this phone number. Please register first.');
  }

  const org = store.getOrgById(user.org_id);
  const sessionToken = signToken({ userId: user.id, orgId: org.id });

  return {
    user: sanitizeUser(user),
    org,
    token: sessionToken,
    supabaseSession: data.session
  };
}

export function sanitizeUser(user) {
  const { password_hash, ...safe } = user;
  return safe;
}
