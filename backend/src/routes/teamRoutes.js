import express from 'express';
import { clerkClient } from '@clerk/express';
import { authMiddleware, sanitizeUser } from '../middleware/authMiddleware.js';
import { requirePermission, requireRole } from '../middleware/rbacMiddleware.js';
import { store, DEFAULT_PERMISSIONS } from '../db/store.js';
import { FRONTEND_URL } from '../config.js';
import { canEditMemberPermissions, isMemberPermissionPatch } from '../../../shared/memberPermissions.js';

const router = express.Router();

router.get('/verify-invite/:code', async (req, res, next) => {
  try {
    const invite = await store.getInvitationByCode(req.params.code.trim().toUpperCase());
    if (!invite) return res.status(404).json({ error: 'Invitation not found or expired.' });
    const org = await store.getOrgById(invite.org_id);
    res.json({ status: 'success', data: { invite_code: invite.invite_code, email: invite.email, role: invite.role, org_name: org?.name || 'ResolveDesk workspace' } });
  } catch (error) { next(error); }
});

router.use(authMiddleware);

router.get('/', async (req, res, next) => {
  try {
    const [members, invitations] = await Promise.all([store.getUsersByOrg(req.org.id), store.getInvitationsByOrg(req.org.id)]);
    res.json({ status: 'success', data: { members: members.map(sanitizeUser), invitations: ['owner', 'admin'].includes(req.user.role) ? invitations : invitations.map(({ id, email, role }) => ({ id, email, role })), quota: { used: members.length + invitations.length, max: req.org.max_members } } });
  } catch (error) { next(error); }
});

router.post('/invite', requirePermission('can_manage_team'), async (req, res, next) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const role = ['admin', 'agent'].includes(req.body.role) ? req.body.role : 'agent';
    if (role === 'admin' && req.user.role !== 'owner') {
      return res.status(403).json({ error: 'Only the workspace owner can invite admins.' });
    }
    const overrides = req.body.permissions ?? {};
    if (!isMemberPermissionPatch(overrides)) {
      return res.status(400).json({ error: 'Permissions must use supported keys and boolean values.' });
    }
    if (Object.keys(overrides).length && !['owner', 'admin'].includes(req.user.role)) {
      return res.status(403).json({ error: 'Only owners and admins can configure permissions.' });
    }
    if (!email || !email.includes('@')) return res.status(400).json({ error: 'A valid email address is required.' });
    const [members, invitations, existing] = await Promise.all([store.getUsersByOrg(req.org.id), store.getInvitationsByOrg(req.org.id), store.getUserByEmail(email, req.org.id)]);
    const pending = invitations.find(invite => invite.email === email);
    if (!pending && members.length + invitations.length >= req.org.max_members) return res.status(403).json({ error: 'Team member limit reached for this plan.' });
    if (existing) return res.status(409).json({ error: 'This person is already a member of your organization.' });
    const permissions = { ...(DEFAULT_PERMISSIONS[role] || DEFAULT_PERMISSIONS.agent), ...overrides };
    if (pending?.role === 'admin' && req.user.role !== 'owner') {
      return res.status(403).json({ error: 'Only the workspace owner can resend admin invitations.' });
    }

    const invitation = pending || await store.createInvitation({ org_id: req.org.id, email, role, permissions });
    const redirectUrl = new URL('/app/sign-up', FRONTEND_URL || 'http://localhost:5173');
    redirectUrl.searchParams.set('invite', invitation.invite_code);
    try {
      const sent = await clerkClient.invitations.createInvitation({
        emailAddress: email,
        redirectUrl: redirectUrl.href,
        notify: true,
        ignoreExisting: true,
        expiresInDays: 7,
      });
      await store.updateInvitation(invitation.id, req.org.id, { clerk_invitation_id: sent.id });
      res.status(pending ? 200 : 201).json({ status: 'success', data: { invitation, email_sent: true } });
    } catch (error) {
      const reason = error.errors?.[0]?.longMessage || error.errors?.[0]?.message || error.message;
      console.warn('Invitation email failed:', reason);
      res.status(502).json({ error: `Invitation saved, but the email could not be sent. ${reason}` });
    }
  } catch (error) { next(error); }
});

router.delete('/invitations/:id', requireRole(['admin']), async (req, res, next) => {
  try {
    const invitation = await store.transitionInvitation(req.params.id, req.org.id, 'pending', { status: 'revoked' });
    if (!invitation) return res.status(404).json({ error: 'Pending invitation not found.' });

    if (invitation.clerk_invitation_id) {
      try {
        await clerkClient.invitations.revokeInvitation(invitation.clerk_invitation_id);
      } catch (error) {
        console.warn('Clerk invitation revocation failed:', error.message);
      }
    }
    res.json({ status: 'success', data: { id: invitation.id } });
  } catch (error) { next(error); }
});

router.patch('/members/:id/permissions', requireRole(['admin']), async (req, res, next) => {
  try {
    const member = await store.getUserById(req.params.id, req.org.id);
    if (!member || member.org_id !== req.org.id) return res.status(404).json({ error: 'Member not found.' });
    if (!canEditMemberPermissions(req.user, member)) {
      return res.status(403).json({ error: 'You cannot edit permissions for this member.' });
    }

    const { role, permissions, ...flatPermissions } = req.body ?? {};
    const changes = permissions === undefined ? flatPermissions : permissions;
    if (!isMemberPermissionPatch(changes) || (role !== undefined && !['admin', 'agent'].includes(role))) {
      return res.status(400).json({ error: 'Enter a valid role and supported boolean permissions.' });
    }
    if (role !== undefined && req.user.role !== 'owner') {
      return res.status(403).json({ error: 'Only the workspace owner can change roles.' });
    }

    const updated = await store.updateUser(member.id, req.org.id, {
      ...(role === undefined ? {} : { role }),
      permissions: { ...member.permissions, ...changes },
    });
    res.json({ status: 'success', data: sanitizeUser(updated) });
  } catch (error) { next(error); }
});

router.delete('/members/:id', async (req, res, next) => {
  try {
    if (req.user.role !== 'owner') {
      return res.status(403).json({ error: 'Only the organization owner can remove team members.' });
    }

    const member = await store.getUserById(req.params.id, req.org.id);
    if (!member || member.org_id !== req.org.id) {
      return res.status(404).json({ error: 'Member not found in your organization.' });
    }
    if (member.role === 'owner') {
      return res.status(403).json({ error: 'The organization owner cannot be removed.' });
    }

    // 1. Strictly delete from Clerk
    if (member.clerk_user_id) {
      try {
        await clerkClient.users.deleteUser(member.clerk_user_id);
        console.log(`✅ [Clerk] Successfully deleted user ${member.clerk_user_id} (${member.email || member.name})`);
      } catch (clerkErr) {
        console.warn(`⚠️ [Clerk] Notice deleting user from Clerk:`, clerkErr.message);
      }
    }

    // 2. Strictly delete from Supabase
    await store.deleteUser(member.id, req.org.id);

    res.json({
      status: 'success',
      message: `Member ${member.name || member.email || 'Agent'} removed successfully from workspace and authentication.`
    });
  } catch (error) {
    next(error);
  }
});

export default router;
