import express from 'express';
import { authMiddleware } from '../middleware/authMiddleware.js';
import { requirePermission } from '../middleware/rbacMiddleware.js';
import { store } from '../db/store.js';
import { replyToComplaint } from '../services/complaintService.js';

const router = express.Router();
router.use(authMiddleware);

/**
 * GET /api/complaints
 * List complaints with optional query filters:
 * ?status=pending|in_progress|resolved|closed
 * ?category=product|delivery|billing|service|other
 * ?assigned_to=userId
 * ?search=query
 */
router.get('/', (req, res) => {
  const { status, category, assigned_to, bot_id, search } = req.query;
  const complaints = store.getComplaints(req.org.id, {
    status,
    category,
    assigned_to,
    bot_id,
    search
  });

  // Enrich complaints with customer and assignee names
  const enriched = complaints.map(c => {
    const customer = store.getCustomerById(c.customer_id);
    const assignee = c.assigned_to ? store.getUserById(c.assigned_to) : null;
    const bot = store.getBotById(c.bot_id);

    return {
      ...c,
      customer: customer ? {
        id: customer.id,
        name: [customer.first_name, customer.last_name].filter(Boolean).join(' ') || customer.username || 'Customer',
        username: customer.username,
        telegram_user_id: customer.telegram_user_id
      } : null,
      assignee: assignee ? {
        id: assignee.id,
        name: assignee.name,
        role: assignee.role
      } : null,
      bot: bot ? {
        id: bot.id,
        username: bot.bot_username,
        title: bot.bot_title
      } : null
    };
  });

  res.json({
    status: 'success',
    count: enriched.length,
    data: enriched
  });
});

/**
 * GET /api/complaints/:id
 * Get full complaint detail, customer info, and message thread
 */
router.get('/:id', (req, res) => {
  const complaint = store.getComplaintById(req.params.id, req.org.id);
  if (!complaint) {
    return res.status(404).json({ error: 'Complaint not found' });
  }

  const customer = store.getCustomerById(complaint.customer_id);
  const assignee = complaint.assigned_to ? store.getUserById(complaint.assigned_to) : null;
  const bot = store.getBotById(complaint.bot_id);
  const messages = store.getMessagesByComplaint(complaint.id);

  res.json({
    status: 'success',
    data: {
      ...complaint,
      customer: customer ? {
        id: customer.id,
        name: [customer.first_name, customer.last_name].filter(Boolean).join(' ') || customer.username || 'Customer',
        username: customer.username,
        phone: customer.phone,
        telegram_user_id: customer.telegram_user_id
      } : null,
      assignee: assignee ? {
        id: assignee.id,
        name: assignee.name,
        role: assignee.role
      } : null,
      bot: bot ? {
        id: bot.id,
        username: bot.bot_username,
        title: bot.bot_title
      } : null,
      messages
    }
  });
});

/**
 * PATCH /api/complaints/:id/status
 * Update complaint status (pending, in_progress, resolved, closed)
 */
router.patch('/:id/status', requirePermission('can_update_status'), (req, res) => {
  const { status } = req.body;
  const allowed = ['pending', 'in_progress', 'resolved', 'closed'];

  if (!status || !allowed.includes(status)) {
    return res.status(400).json({ error: `Invalid status. Must be one of: ${allowed.join(', ')}` });
  }

  const updated = store.updateComplaint(req.params.id, { status }, req.org.id);
  if (!updated) {
    return res.status(404).json({ error: 'Complaint not found' });
  }

  // Record system audit message in thread
  store.addMessage({
    complaint_id: updated.id,
    sender_type: 'system',
    sender_id: req.user.id,
    sender_name: 'System',
    message_text: `Status changed to '${status}' by ${req.user.name}.`
  });

  res.json({
    status: 'success',
    message: `Complaint status updated to '${status}'`,
    data: updated
  });
});

/**
 * PATCH /api/complaints/:id/assign
 * Assign complaint to a team member
 */
router.patch('/:id/assign', requirePermission('can_assign'), (req, res) => {
  const { assigned_to } = req.body; // user ID or null to unassign

  let assigneeName = 'Unassigned';
  if (assigned_to) {
    const assignee = store.getUserById(assigned_to);
    if (!assignee || assignee.org_id !== req.org.id) {
      return res.status(400).json({ error: 'Assigned user does not exist in your organization' });
    }
    assigneeName = assignee.name;
  }

  const updated = store.updateComplaint(req.params.id, { assigned_to: assigned_to || null }, req.org.id);
  if (!updated) {
    return res.status(404).json({ error: 'Complaint not found' });
  }

  // Record assignment audit in thread
  store.addMessage({
    complaint_id: updated.id,
    sender_type: 'system',
    sender_id: req.user.id,
    sender_name: 'System',
    message_text: `Ticket assigned to ${assigneeName} by ${req.user.name}.`
  });

  res.json({
    status: 'success',
    message: `Complaint assigned to ${assigneeName}`,
    data: updated
  });
});

/**
 * PATCH /api/complaints/:id/category
 * Update category or priority
 */
router.patch('/:id/category', (req, res) => {
  const { category, priority } = req.body;
  const updates = {};

  if (category) {
    const allowedCategories = ['product', 'delivery', 'billing', 'service', 'other'];
    if (!allowedCategories.includes(category)) {
      return res.status(400).json({ error: `Invalid category. Must be one of: ${allowedCategories.join(', ')}` });
    }
    updates.category = category;
  }

  if (priority) {
    const allowedPriorities = ['low', 'medium', 'high', 'urgent'];
    if (!allowedPriorities.includes(priority)) {
      return res.status(400).json({ error: `Invalid priority. Must be one of: ${allowedPriorities.join(', ')}` });
    }
    updates.priority = priority;
  }

  const updated = store.updateComplaint(req.params.id, updates, req.org.id);
  if (!updated) {
    return res.status(404).json({ error: 'Complaint not found' });
  }

  res.json({
    status: 'success',
    data: updated
  });
});

/**
 * POST /api/complaints/:id/reply
 * Staff sends a reply to customer -> stores in thread and dispatches via Telegram
 */
router.post('/:id/reply', requirePermission('can_reply'), async (req, res) => {
  try {
    const { text } = req.body;
    if (!text || !text.trim()) {
      return res.status(400).json({ error: 'Reply text cannot be empty' });
    }

    const message = await replyToComplaint({
      complaintId: req.params.id,
      orgId: req.org.id,
      user: req.user,
      messageText: text.trim()
    });

    res.status(201).json({
      status: 'success',
      message: 'Reply sent to customer via Telegram',
      data: message
    });
  } catch (err) {
    res.status(400).json({ status: 'error', error: err.message });
  }
});

export default router;
