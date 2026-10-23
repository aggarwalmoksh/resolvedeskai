import { store } from '../db/store.js';

/**
 * Quota & Subscription Limit Enforcement Middleware
 */

export function checkBotQuota(req, res, next) {
  const org = req.org;
  if (!org) {
    return res.status(400).json({ error: 'Organization context missing' });
  }

  const currentBots = store.getBotsByOrg(org.id);
  if (currentBots.length >= org.max_bots) {
    return res.status(403).json({
      error: 'Bot limit reached for your current subscription plan.',
      currentCount: currentBots.length,
      maxAllowed: org.max_bots,
      plan: org.subscription_tier,
      message: `Your current plan allows up to ${org.max_bots} bot(s). Please upgrade your subscription in the portal to link more bots.`
    });
  }

  next();
}

export function checkMemberQuota(req, res, next) {
  const org = req.org;
  if (!org) {
    return res.status(400).json({ error: 'Organization context missing' });
  }

  const activeUsers = store.getUsersByOrg(org.id);
  const pendingInvites = store.getInvitationsByOrg(org.id);
  const totalSlotsUsed = activeUsers.length + pendingInvites.length;

  if (totalSlotsUsed >= org.max_members) {
    return res.status(403).json({
      error: 'Team member limit reached for your current subscription plan.',
      currentCount: totalSlotsUsed,
      maxAllowed: org.max_members,
      plan: org.subscription_tier,
      message: `Your current plan allows up to ${org.max_members} team members/invites. Please upgrade your subscription in the portal to invite more members.`
    });
  }

  next();
}
