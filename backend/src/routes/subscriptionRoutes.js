import express from 'express';
import { authMiddleware } from '../middleware/authMiddleware.js';
import { requireRole } from '../middleware/rbacMiddleware.js';
import { store, PLANS } from '../db/store.js';

const router = express.Router();
router.use(authMiddleware);

/**
 * GET /api/subscription
 * Get current subscription status and usage quotas
 */
router.get('/', (req, res) => {
  const org = req.org;
  const currentBots = store.getBotsByOrg(org.id);
  const currentMembers = store.getUsersByOrg(org.id);
  const pendingInvites = store.getInvitationsByOrg(org.id);
  const planInfo = PLANS[org.subscription_tier] || PLANS.starter;

  res.json({
    status: 'success',
    data: {
      plan: planInfo,
      usage: {
        bots: {
          current: currentBots.length,
          max: org.max_bots,
          available: Math.max(0, org.max_bots - currentBots.length)
        },
        team_members: {
          current: currentMembers.length,
          pending_invites: pendingInvites.length,
          total_used: currentMembers.length + pendingInvites.length,
          max: org.max_members,
          available: Math.max(0, org.max_members - (currentMembers.length + pendingInvites.length))
        }
      }
    }
  });
});

/**
 * GET /api/subscription/plans
 * List all available subscription tiers
 */
router.get('/plans', (req, res) => {
  res.json({
    status: 'success',
    data: Object.values(PLANS)
  });
});

/**
 * POST /api/subscription/upgrade
 * Upgrade organization's subscription tier
 */
router.post('/upgrade', requireRole(['owner']), (req, res) => {
  const { plan_id } = req.body;
  const targetPlan = PLANS[plan_id];

  if (!targetPlan) {
    return res.status(400).json({
      error: `Invalid plan_id. Must be one of: ${Object.keys(PLANS).join(', ')}`
    });
  }

  // Update org with new plan limits
  const updatedOrg = store.updateOrg(req.org.id, {
    subscription_tier: targetPlan.id,
    max_bots: targetPlan.max_bots,
    max_members: targetPlan.max_members
  });

  res.json({
    status: 'success',
    message: `Subscription successfully upgraded to ${targetPlan.name}!`,
    data: {
      org: updatedOrg,
      new_limits: {
        max_bots: targetPlan.max_bots,
        max_members: targetPlan.max_members
      }
    }
  });
});

export default router;
