import express from 'express';
import { authMiddleware } from '../middleware/authMiddleware.js';
import { complaintAssigneeScope, requirePermission } from '../middleware/rbacMiddleware.js';
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
router.get('/', async (req, res, next) => {
  try {
    const { status, category, assigned_to, bot_id, search } = req.query;
    const complaints = await store.getComplaints(req.org.id, {
      status,
      category,
      participant_id: complaintAssigneeScope(req.user),
      assigned_to,
      bot_id,
      search
    });

    // Enrich complaints with customer and assignee names
    const enriched = await Promise.all(complaints.map(async c => {
      const customer = c.customers || await store.getCustomerById(c.customer_id, req.org.id);
      const assignee = c.assignee || (c.assigned_to ? await store.getUserById(c.assigned_to, req.org.id) : null);
      const bot = c.bots || await store.getBotById(c.bot_id, req.org.id);
      const messages = await store.getMessagesByComplaint(c.id, req.org.id);

      const { customers, bots, assignee: joinedAssignee, ...fields } = c;
      return {
        ...fields,
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
        } : null,
        messages: messages || []
      };
    }));

    res.json({
      status: 'success',
      count: enriched.length,
      data: enriched
    });
  } catch (error) { next(error); }
});

/**
 * GET /api/complaints/:id
 * Get full complaint detail, customer info, and message thread
 */
router.get('/:id', async (req, res, next) => {
  try {
    const complaint = await store.getComplaintById(req.params.id, req.org.id, complaintAssigneeScope(req.user));
    if (!complaint) {
      return res.status(404).json({ error: 'Complaint not found' });
    }

    const customer = complaint.customers || await store.getCustomerById(complaint.customer_id, req.org.id);
    const assignee = complaint.assignee || (complaint.assigned_to ? await store.getUserById(complaint.assigned_to, req.org.id) : null);
    const bot = complaint.bots || await store.getBotById(complaint.bot_id, req.org.id);
    const messages = await store.getMessagesByComplaint(complaint.id, req.org.id);

    const { customers, bots, assignee: joinedAssignee, ...fields } = complaint;
    res.json({
      status: 'success',
      data: {
        ...fields,
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
  } catch (error) { next(error); }
});

/**
 * PATCH /api/complaints/:id/status
 * Update complaint status (pending, in_progress, resolved, closed)
 */
router.patch('/:id/status', requirePermission('can_update_status'), async (req, res, next) => {
  try {
    const { status } = req.body;
    const allowed = ['pending', 'in_progress', 'resolved', 'closed'];

    if (!status || !allowed.includes(status)) {
      return res.status(400).json({ error: `Invalid status. Must be one of: ${allowed.join(', ')}` });
    }

    const updated = await store.updateComplaint(req.params.id, { status }, req.org.id, complaintAssigneeScope(req.user));
    if (!updated) {
      return res.status(404).json({ error: 'Complaint not found' });
    }

    // Record system audit message in thread
    await store.addMessage({
      org_id: req.org.id,
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
  } catch (error) { next(error); }
});

/**
 * PATCH /api/complaints/:id/assign
 * Assign complaint to a team member
 */
function canManageTicketParticipants(user, complaint) {
  return complaint.assigned_to === user.id ||
    (!complaintAssigneeScope(user) && (user.role === 'owner' || user.permissions?.can_assign === true));
}

async function activeWorkspaceMember(id, orgId) {
  if (typeof id !== 'string' || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(id)) return null;
  const member = await store.getUserById(id, orgId);
  return member?.org_id === orgId && member.is_active ? member : null;
}

router.patch('/:id/assign', async (req, res, next) => {
  try {
    const { assigned_to } = req.body;
    const complaint = await store.getComplaintById(req.params.id, req.org.id, complaintAssigneeScope(req.user));
    if (!complaint) return res.status(404).json({ error: 'Complaint not found' });
    const canUnassign = req.user.role === 'owner' || req.user.permissions?.can_assign === true;
    if (!canManageTicketParticipants(req.user, complaint) || (assigned_to === null && !canUnassign)) {
      return res.status(403).json({ error: 'You cannot change the assignee for this ticket.' });
    }

    const assignee = assigned_to === null ? null : await activeWorkspaceMember(assigned_to, req.org.id);
    if (assigned_to !== null && !assignee) return res.status(400).json({ error: 'Choose an active workspace member.' });
    const updated = await store.updateComplaint(complaint.id, {
      assigned_to,
      collaborator_ids: (complaint.collaborator_ids || []).filter(memberId => memberId !== assigned_to),
    }, req.org.id, complaintAssigneeScope(req.user), complaint);
    if (!updated) return res.status(409).json({ error: 'The ticket team changed. Refresh and try again.' });

    const message = await store.addMessage({
      org_id: req.org.id,
      complaint_id: complaint.id, sender_type: 'system', sender_id: req.user.id,
      sender_name: 'System',
      message_text: assignee ? `Ticket assigned to ${assignee.name} by ${req.user.name}.` : `Ticket unassigned by ${req.user.name}.`,
    });
    res.json({ status: 'success', data: { ...updated, message } });
  } catch (error) { next(error); }
});

router.patch('/:id/collaborators', async (req, res, next) => {
  try {
    const { member_id, member_ids, add } = req.body;
    const requestedIds = member_ids ?? [member_id];
    if (!Array.isArray(requestedIds) || !requestedIds.length || typeof add !== 'boolean') {
      return res.status(400).json({ error: 'Choose at least one workspace member.' });
    }
    const complaint = await store.getComplaintById(req.params.id, req.org.id, complaintAssigneeScope(req.user));
    if (!complaint) return res.status(404).json({ error: 'Complaint not found' });
    if (!canManageTicketParticipants(req.user, complaint)) {
      return res.status(403).json({ error: 'You cannot manage this ticket’s collaborators.' });
    }
    const ids = [...new Set(requestedIds)];
    const members = await Promise.all(ids.map(id => activeWorkspaceMember(id, req.org.id)));
    if (members.some(member => !member || member.id === complaint.assigned_to)) {
      return res.status(400).json({ error: 'Choose active workspace members other than the assignee.' });
    }
    const collaborators = new Set(complaint.collaborator_ids || []);
    for (const member of members) {
      if (add) collaborators.add(member.id);
      else collaborators.delete(member.id);
    }
    const updated = await store.updateComplaint(complaint.id, { collaborator_ids: [...collaborators] },
      req.org.id, complaintAssigneeScope(req.user), complaint);
    if (!updated) return res.status(409).json({ error: 'The ticket team changed. Refresh and try again.' });
    res.json({ status: 'success', data: updated });
  } catch (error) { next(error); }
});

router.post('/:id/notes', async (req, res, next) => {
  try {
    const text = typeof req.body.text === 'string' ? req.body.text.trim() : '';
    if (!text || text.length > 4000) return res.status(400).json({ error: 'Enter a note of up to 4,000 characters.' });
    const complaint = await store.getComplaintById(req.params.id, req.org.id, complaintAssigneeScope(req.user));
    if (!complaint) return res.status(404).json({ error: 'Complaint not found' });
    const note = await store.addMessage({
      org_id: req.org.id,
      complaint_id: complaint.id, sender_type: 'internal_note', sender_id: req.user.id,
      sender_name: req.user.name, message_text: text,
    });
    res.status(201).json({ status: 'success', data: note });
  } catch (error) { next(error); }
});

/**
 * PATCH /api/complaints/:id/category
 * Update category or priority
 */
router.patch('/:id/category', async (req, res, next) => {
  try {
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

    const updated = await store.updateComplaint(req.params.id, updates, req.org.id, complaintAssigneeScope(req.user));
    if (!updated) {
      return res.status(404).json({ error: 'Complaint not found' });
    }

    res.json({
      status: 'success',
      data: updated
    });
  } catch (error) { next(error); }
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
