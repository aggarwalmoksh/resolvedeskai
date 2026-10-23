import express from 'express';
import { authMiddleware } from '../middleware/authMiddleware.js';
import { requirePermission } from '../middleware/rbacMiddleware.js';
import { checkMemberQuota } from '../middleware/quotaMiddleware.js';
import { store, DEFAULT_PERMISSIONS } from '../db/store.js';
import { hashPassword, signToken, sanitizeUser } from '../services/authService.js';

const router = express.Router();

/**
 * POST /api/team/accept-invite (Public)
 * Invited member enters invite code, completes profile, and joins the business
 */
router.post('/accept-invite', (req, res) => {
  try {
    const { invite_code, name, password } = req.body;
    if (!invite_code || !name) {
      return res.status(400).json({ error: 'invite_code and name are required' });
    }

    const invite = store.getInvitationByCode(invite_code.trim());
    if (!invite) {
      return res.status(404).json({ error: 'Invalid or expired invitation code' });
    }

    const org = store.getOrgById(invite.org_id);
    if (!org) {
      return res.status(404).json({ error: 'Organization no longer exists' });
    }

    // Check if user already exists
    let user = store.getUserByPhone(invite.phone, org.id);
    if (user) {
      return res.status(400).json({ error: 'A user with this phone already exists in this organization' });
    }

    const passwordHash = password ? hashPassword(password) : null;
    user = store.createUser({
      org_id: org.id,
      name: name.trim(),
      phone: invite.phone,
      password_hash: passwordHash,
      role: invite.role,
      permissions: invite.permissions
    });

    // Mark invitation accepted
    store.updateInvitation(invite.id, { status: 'accepted' });

    const token = signToken({ userId: user.id, orgId: org.id });

    res.status(201).json({
      status: 'success',
      message: `Welcome to ${org.name}!`,
      data: {
        user: sanitizeUser(user),
        org,
        token
      }
    });
  } catch (err) {
    res.status(400).json({ status: 'error', error: err.message });
  }
});

// All following routes require authentication
router.use(authMiddleware);

/**
 * GET /api/team
 * List active team members and pending invites
 */
router.get('/', (req, res) => {
  const members = store.getUsersByOrg(req.org.id).map(sanitizeUser);
  const invitations = store.getInvitationsByOrg(req.org.id);

  res.json({
    status: 'success',
    data: {
      members,
      invitations,
      quota: {
        used: members.length + invitations.length,
        max: req.org.max_members
      }
    }
  });
});

/**
 * POST /api/team/invite
 * Invite a business partner/staff member by phone with specific permissions
 */
router.post('/invite', requirePermission('can_manage_team'), checkMemberQuota, (req, res) => {
  try {
    const { phone, role = 'agent', permissions } = req.body;
    if (!phone) {
      return res.status(400).json({ error: 'Phone number is required to invite a member' });
    }

    const cleanPhone = phone.trim();

    // Check if already an active member
    const existingUser = store.getUserByPhone(cleanPhone, req.org.id);
    if (existingUser) {
      return res.status(400).json({ error: 'This phone number is already a registered member of your organization' });
    }

    // Default permissions based on role if not explicitly customized
    const finalPermissions = permissions ? {
      ...DEFAULT_PERMISSIONS[role] || DEFAULT_PERMISSIONS.agent,
      ...permissions
    } : DEFAULT_PERMISSIONS[role] || DEFAULT_PERMISSIONS.agent;

    const invite = store.createInvitation({
      org_id: req.org.id,
      phone: cleanPhone,
      role,
      permissions: finalPermissions
    });

    res.status(201).json({
      status: 'success',
      message: `Invitation generated for ${cleanPhone}`,
      data: {
        invitation: invite,
        join_instructions: `Share code '${invite.invite_code}' with your team member to let them join.`
      }
    });
  } catch (err) {
    res.status(400).json({ status: 'error', error: err.message });
  }
});

/**
 * PATCH /api/team/members/:id/permissions
 * Update a member's role or granular permissions
 */
router.patch('/members/:id/permissions', requirePermission('can_manage_team'), (req, res) => {
  const member = store.getUserById(req.params.id);
  if (!member || member.org_id !== req.org.id) {
    return res.status(404).json({ error: 'Member not found in your organization' });
  }

  // Prevent modifying the organization owner
  if (member.role === 'owner' && req.user.id !== member.id) {
    return res.status(403).json({ error: 'Cannot modify permissions of the organization owner' });
  }

  const { role, permissions } = req.body;
  const updates = {};

  if (role) updates.role = role;
  if (permissions) {
    updates.permissions = {
      ...member.permissions,
      ...permissions
    };
  }

  const updated = store.updateUser(member.id, updates);

  res.json({
    status: 'success',
    message: 'Permissions updated successfully',
    data: sanitizeUser(updated)
  });
});

/**
 * DELETE /api/team/members/:id
 * Remove a member from the organization
 */
router.delete('/members/:id', requirePermission('can_manage_team'), (req, res) => {
  const member = store.getUserById(req.params.id);
  if (!member || member.org_id !== req.org.id) {
    return res.status(404).json({ error: 'Member not found in your organization' });
  }

  if (member.role === 'owner') {
    return res.status(403).json({ error: 'Cannot remove the organization owner' });
  }

  store.deleteUser(member.id);

  res.json({
    status: 'success',
    message: `Team member ${member.name} removed from organization`
  });
});

export default router;
