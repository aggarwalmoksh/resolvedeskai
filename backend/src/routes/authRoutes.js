import express from 'express';
import { clerkClient, getAuth, verifyToken } from '@clerk/express';
import { authMiddleware, sanitizeUser } from '../middleware/authMiddleware.js';
import { store, DEFAULT_PERMISSIONS } from '../db/store.js';
import { complaintAssigneeScope } from '../middleware/rbacMiddleware.js';
import { CLERK_SECRET_KEY } from '../config.js';

const router = express.Router();

async function clerkIdentity(req) {
  let userId = null;
  let sessionClaims = null;

  try {
    const auth = getAuth(req);
    if (auth?.userId) {
      userId = auth.userId;
      sessionClaims = auth.sessionClaims;
    }
  } catch (err) {
    console.warn('[clerkIdentity] getAuth error:', err.message);
  }

  // Fallback: If clerkMiddleware didn't extract userId, inspect the Authorization header directly
  if (!userId) {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const rawToken = authHeader.slice(7).trim();
      if (rawToken && rawToken !== 'null' && rawToken !== 'undefined') {
        try {
          const verified = await verifyToken(rawToken, { secretKey: CLERK_SECRET_KEY });
          if (verified?.sub) {
            userId = verified.sub;
            sessionClaims = verified;
          }
        } catch {
          // Unverified tokens do not establish identity.
        }
      }
    }
  }

  if (!userId) {
    const err = new Error('Authentication required.');
    err.statusCode = 401;
    throw err;
  }

  const clerkUser = await clerkClient.users.getUser(userId);

  const email = clerkUser?.primaryEmailAddress?.emailAddress?.toLowerCase() ||
    clerkUser?.emailAddresses?.[0]?.emailAddress?.toLowerCase() ||
    sessionClaims?.email ||
    null;

  const name = [clerkUser?.firstName, clerkUser?.lastName].filter(Boolean).join(' ').trim() ||
    clerkUser?.username ||
    email?.split('@')[0] ||
    'ResolveDesk user';

  const phone = clerkUser?.primaryPhoneNumber?.phoneNumber ||
    clerkUser?.phoneNumbers?.[0]?.phoneNumber ||
    null;

  const verifiedEmails = (clerkUser?.emailAddresses || [])
    .filter(address => address.verification?.status === 'verified')
    .map(address => address.emailAddress.toLowerCase());

  return { clerk_user_id: userId, email, name, phone, verifiedEmails };
}

// Creates the app tenant only after Clerk has established an identity.
router.post('/onboard-business', async (req, res, next) => {
  try {
    const { verifiedEmails: _verifiedEmails, ...identity } = await clerkIdentity(req);
    const businessName = String(req.body.businessName || '').trim();
    if (!businessName) return res.status(400).json({ error: 'Organization name is required.' });

    const existingUser = await store.getUserByClerkId(identity.clerk_user_id);
    if (existingUser) {
      const org = await store.getOrgById(existingUser.org_id);
      return res.status(200).json({ status: 'success', data: { user: sanitizeUser(existingUser), org } });
    }

    const org = await store.createOrg({ name: businessName, phone: identity.phone, subscription_tier: 'starter' });
    const user = await store.createUser({ ...identity, org_id: org.id, role: 'owner', permissions: DEFAULT_PERMISSIONS.owner });
    res.status(201).json({ status: 'success', data: { user: sanitizeUser(user), org } });
  } catch (error) {
    console.error('❌ [onboard-business] Error:', error);
    next(error);
  }
});

router.get('/pending-invitations', async (req, res, next) => {
  try {
    const { verifiedEmails } = await clerkIdentity(req);
    const lists = await Promise.all([...new Set(verifiedEmails)].map(email => store.getPendingInvitationsForEmail(email)));
    const data = lists.flat().map(invite => ({
      invite_code: invite.invite_code,
      role: invite.role,
      org_name: invite.organizations?.name || 'ResolveDesk workspace',
    }));
    res.json({ status: 'success', data });
  } catch (error) { next(error); }
});

// Completes a Clerk-authenticated invitation. The recipient email must match.
router.post('/complete-invitation', async (req, res, next) => {
  try {
    const { verifiedEmails, ...identity } = await clerkIdentity(req);
    const inviteCode = String(req.body.inviteCode || '').trim().toUpperCase();
    if (!inviteCode) return res.status(400).json({ error: 'Invitation code is required.' });
    const invite = await store.getInvitationByCode(inviteCode);
    if (!invite) return res.status(404).json({ error: 'This invitation is invalid, expired, or has already been used.' });
    if (!verifiedEmails.includes(invite.email.toLowerCase())) return res.status(403).json({ error: 'Sign in with the email address this invitation was sent to.' });
    const existing = await store.getUserByClerkId(identity.clerk_user_id);
    if (existing) {
      if (existing.org_id !== invite.org_id || !existing.is_active) {
        return res.status(409).json({ error: 'This account already has a workspace membership.' });
      }
      return res.json({ status: 'success', data: { user: sanitizeUser(existing), org: await store.getOrgById(existing.org_id) } });
    }
    const claimed = await store.transitionInvitation(invite.id, invite.org_id, 'pending', { status: 'accepting' });
    if (!claimed) return res.status(409).json({ error: 'This invitation is no longer pending.' });

    let user;
    try {
      user = await store.createUser({ ...identity, email: invite.email, org_id: invite.org_id, role: invite.role, permissions: invite.permissions });
    } catch (error) {
      await store.transitionInvitation(invite.id, invite.org_id, 'accepting', { status: 'pending' });
      throw error;
    }
    await store.transitionInvitation(invite.id, invite.org_id, 'accepting', {
      status: 'accepted',
      accepted_by_clerk_user_id: identity.clerk_user_id,
      accepted_at: new Date().toISOString(),
    });
    res.status(201).json({ status: 'success', data: { user: sanitizeUser(user), org: await store.getOrgById(invite.org_id) } });
  } catch (error) {
    console.error('❌ [complete-invitation] Error:', error);
    next(error);
  }
});

router.get('/me', authMiddleware, async (req, res, next) => {
  try {
    const [bots, members, complaints] = await Promise.all([store.getBotsByOrg(req.org.id), store.getUsersByOrg(req.org.id), store.getComplaints(req.org.id, { participant_id: complaintAssigneeScope(req.user) })]);
    res.json({ status: 'success', data: { user: req.user, org: { ...req.org, stats: { botsCount: bots.length, membersCount: members.length, complaintsCount: complaints.length } } } });
  } catch (error) { next(error); }
});

export default router;
