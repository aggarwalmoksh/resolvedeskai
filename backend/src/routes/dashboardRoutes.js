import express from 'express';
import { authMiddleware } from '../middleware/authMiddleware.js';
import { store } from '../db/store.js';

const router = express.Router();
router.use(authMiddleware);

/**
 * GET /api/dashboard/stats
 * Primary metrics for the dashboard summary cards
 */
router.get('/stats', (req, res) => {
  const orgId = req.org.id;
  const complaints = store.getComplaints(orgId);
  const bots = store.getBotsByOrg(orgId);
  const members = store.getUsersByOrg(orgId);

  const total = complaints.length;
  const pending = complaints.filter(c => c.status === 'pending').length;
  const in_progress = complaints.filter(c => c.status === 'in_progress').length;
  const resolved = complaints.filter(c => c.status === 'resolved').length;
  const closed = complaints.filter(c => c.status === 'closed').length;

  res.json({
    status: 'success',
    data: {
      complaints: {
        total,
        pending,
        in_progress,
        resolved,
        closed,
        active_open: pending + in_progress,
        resolution_rate_percent: total > 0 ? Math.round(((resolved + closed) / total) * 100) : 0
      },
      resources: {
        active_bots: bots.length,
        max_bots: req.org.max_bots,
        active_team_members: members.length,
        max_team_members: req.org.max_members
      }
    }
  });
});

/**
 * GET /api/dashboard/categories
 * Category-wise distribution of complaints (Product, Delivery, Billing, Service, Other)
 */
router.get('/categories', (req, res) => {
  const orgId = req.org.id;
  const complaints = store.getComplaints(orgId);
  const total = complaints.length;

  const categories = ['product', 'delivery', 'billing', 'service', 'other'];
  const breakdown = categories.map(cat => {
    const count = complaints.filter(c => c.category === cat).length;
    return {
      category: cat,
      count,
      percentage: total > 0 ? Math.round((count / total) * 100) : 0
    };
  });

  res.json({
    status: 'success',
    data: {
      total,
      breakdown
    }
  });
});

/**
 * GET /api/dashboard/trends
 * Volume trends over the past 7 days
 */
router.get('/trends', (req, res) => {
  const orgId = req.org.id;
  const complaints = store.getComplaints(orgId);

  // Group by day for the last 7 days
  const days = {};
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().split('T')[0];
    days[dateStr] = 0;
  }

  complaints.forEach(c => {
    const dateStr = c.created_at.split('T')[0];
    if (days[dateStr] !== undefined) {
      days[dateStr]++;
    }
  });

  const trendData = Object.entries(days).map(([date, count]) => ({ date, count }));

  res.json({
    status: 'success',
    data: trendData
  });
});

export default router;
