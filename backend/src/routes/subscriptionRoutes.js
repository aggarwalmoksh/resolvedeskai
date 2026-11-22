import { readBotToken } from '../services/botSecrets.js';
import express from 'express';
import { authMiddleware } from '../middleware/authMiddleware.js';
import { requireRole } from '../middleware/rbacMiddleware.js';
import { store, PLANS } from '../db/store.js';
import { registerBotWebhook, deleteBotWebhook } from '../services/telegramService.js';

const router = express.Router();
router.use(authMiddleware);

/**
 * GET /api/subscription
 * Get current subscription status and usage quotas
 */
router.get('/', async (req, res) => {
  const org = req.org;
  const allBots = await store.getBotsByOrg(org.id);
  const activeBots = allBots.filter(b => b.status === 'active');
  const pausedBots = allBots.filter(b => b.status === 'paused' || b.status === 'suspended');
  const currentMembers = await store.getUsersByOrg(org.id);
  const pendingInvites = await store.getInvitationsByOrg(org.id);
  const planInfo = PLANS[org.subscription_tier] || PLANS.starter;

  res.json({
    status: 'success',
    data: {
      plan: planInfo,
      billing_period: org.billing_period || 'monthly',
      usage: {
        bots: {
          current: allBots.length,
          active: activeBots.length,
          paused: pausedBots.length,
          max: org.max_bots,
          available: Math.max(0, org.max_bots - activeBots.length)
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
 * Change subscription tier (Upgrades and Downgrades)
 * Handles auto-pausing excess bots on downgrade and auto-reactivating on upgrade
 */
router.post('/upgrade', requireRole(['owner']), async (req, res) => {
  try {
    const { plan_id, billing_period = 'monthly' } = req.body;
    const targetPlan = Object.hasOwn(PLANS, plan_id) ? PLANS[plan_id] : null;

    if (!targetPlan) {
      return res.status(400).json({
        error: `Invalid plan_id. Must be one of: ${Object.keys(PLANS).join(', ')}`
      });
    }

    if (billing_period !== 'monthly' && (billing_period !== 'annual' || targetPlan.id !== 'growth')) {
      return res.status(400).json({ error: 'Annual billing is available for Growth.' });
    }

    const currentOrg = req.org;
    const samePlan = currentOrg.subscription_tier === targetPlan.id &&
      currentOrg.max_bots === targetPlan.max_bots && currentOrg.max_members === targetPlan.max_members;
    const planUpdates = {
      subscription_tier: targetPlan.id,
      max_bots: targetPlan.max_bots,
      max_members: targetPlan.max_members,
    };

    let updatedOrg;
    try {
      updatedOrg = await store.updateOrg(currentOrg.id, { ...planUpdates, billing_period });
    } catch (err) {
      if (err.code !== 'PGRST204' || !err.message.includes('billing_period')) throw err;
      if (billing_period === 'annual') {
        return res.status(503).json({ error: 'Annual billing requires the billing-period database migration.' });
      }
      updatedOrg = await store.updateOrg(currentOrg.id, planUpdates);
    }
    if (samePlan) {
      return res.json({ status: 'success', message: 'Billing period updated.', data: { org: updatedOrg } });
    }
    const currentBots = await store.getBotsByOrg(currentOrg.id, { includeCredentials: true });

    let botsPaused = 0;
    let botsReactivated = 0;

    // 1. Handle Bot Capacity Adjustments
    if (currentBots.length > targetPlan.max_bots) {
      // Downgrade scenario: Keep first targetPlan.max_bots active, strictly pause and deregister the rest
      for (let i = 0; i < currentBots.length; i++) {
        const b = currentBots[i];
        if (i < targetPlan.max_bots) {
          if (b.status !== 'active') {
            await store.updateBot(b.id, currentOrg.id, { status: 'active' });
            try {
              if (b.webhook_url && b.secret_token) {
                await registerBotWebhook(readBotToken(b), b.webhook_url, b.secret_token);
              }
            } catch (err) {
              console.warn(`Could not register webhook for bot @${b.bot_username}:`, err.message);
            }
          }
        } else {
          // Strictly pause excess bot and delete its Telegram webhook
          await store.updateBot(b.id, currentOrg.id, { status: 'paused' });
          botsPaused++;
          try {
            await deleteBotWebhook(readBotToken(b));
            console.log(`⏸️  [Downgrade] Paused excess bot @${b.bot_username} and deleted Telegram webhook`);
          } catch (err) {
            console.warn(`Could not delete webhook for paused bot @${b.bot_username}:`, err.message);
          }
        }
      }
    } else if (targetPlan.max_bots > currentOrg.max_bots) {
      // Upgrade scenario: Reactivate any paused bots up to new capacity
      const pausedBots = currentBots.filter(b => b.status === 'paused' || b.status === 'suspended');
      let availableSlots = targetPlan.max_bots - currentBots.filter(b => b.status === 'active').length;

      for (const b of pausedBots) {
        if (availableSlots > 0) {
          await store.updateBot(b.id, currentOrg.id, { status: 'active' });
          availableSlots--;
          botsReactivated++;
          try {
            if (b.webhook_url && b.secret_token) {
              await registerBotWebhook(readBotToken(b), b.webhook_url, b.secret_token);
              console.log(`▶️  [Upgrade] Reactivated bot @${b.bot_username} and registered Telegram webhook`);
            }
          } catch (err) {
            console.warn(`Could not re-register webhook for reactivated bot @${b.bot_username}:`, err.message);
          }
        }
      }
    }

    let message = `Subscription successfully changed to ${targetPlan.name}!`;
    if (botsPaused > 0) {
      message = `Subscription changed to ${targetPlan.name}. ${targetPlan.max_bots} bot remains active; ${botsPaused} excess bot(s) have been paused and their Telegram webhooks disconnected.`;
    } else if (botsReactivated > 0) {
      message = `Subscription upgraded to ${targetPlan.name}! ${botsReactivated} previously paused bot(s) have been automatically reactivated.`;
    }

    res.json({
      status: 'success',
      message,
      data: {
        org: updatedOrg,
        new_limits: {
          max_bots: targetPlan.max_bots,
          max_members: targetPlan.max_members
        },
        bots_paused: botsPaused,
        bots_reactivated: botsReactivated
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
