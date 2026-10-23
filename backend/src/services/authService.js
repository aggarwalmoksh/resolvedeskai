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

// Register Business Owner and create Organization
export async function registerOwner({ name, phone, password, businessName, subscriptionTier = 'starter' }) {
  if (!phone || !name || !businessName) {
    throw new Error('Name, phone, and business name are required');
  }

  const cleanPhone = phone.trim();
  const existingUser = store.getUserByPhone(cleanPhone);
  if (existingUser) {
    throw new Error('A user with this phone number already exists');
  }

  // 1. Create Organization with specified subscription tier
  const org = store.createOrg({
    name: businessName,
    phone: cleanPhone,
    subscription_tier: subscriptionTier
  });

  // 2. Create Owner User
  const passwordHash = password ? hashPassword(password) : null;
  const user = store.createUser({
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

// Login User
export async function loginUser({ phone, password }) {
  if (!phone) throw new Error('Phone number is required');

  const cleanPhone = phone.trim();
  const user = store.getUserByPhone(cleanPhone);
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

export function sanitizeUser(user) {
  const { password_hash, ...safe } = user;
  return safe;
}
