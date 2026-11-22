import { readBotToken } from './botSecrets.js';
import { complaintAssigneeScope } from '../middleware/rbacMiddleware.js';
import { store } from '../db/store.js';
import { sendTelegramReply } from './telegramService.js';

/**
 * Intelligent Keyword Categorizer
 * Automatically tags complaints into product, delivery, billing, service, or other.
 */
export function detectCategory(text) {
  if (!text || typeof text !== 'string') return 'other';
  const lower = text.toLowerCase();

  const rules = [
    {
      category: 'delivery',
      keywords: ['delivery', 'late', 'where is', 'track', 'courier', 'rider', 'delay', 'shipping', 'dispatch', 'not received', 'arrive']
    },
    {
      category: 'product',
      keywords: ['flower', 'wilted', 'damaged', 'broken', 'quality', 'wrong item', 'item', 'decayed', 'stale', 'smell', 'rotten', 'fresh']
    },
    {
      category: 'billing',
      keywords: ['refund', 'charged', 'charge', 'price', 'payment', 'money', 'receipt', 'upi', 'credit card', 'bank', 'overcharged', 'bill']
    },
    {
      category: 'service',
      keywords: ['rude', 'agent', 'support', 'unhelpful', 'behavior', 'call', 'staff', 'attitude']
    }
  ];

  for (const rule of rules) {
    if (rule.keywords.some(k => lower.includes(k))) {
      return rule.category;
    }
  }

  return 'other';
}

/**
 * Staff reply to customer - saves in thread & dispatches to Telegram
 */
export async function replyToComplaint({ complaintId, orgId, user, messageText }) {
  const complaint = await store.getComplaintById(complaintId, orgId, complaintAssigneeScope(user));
  if (!complaint) throw new Error('Complaint not found');

  const customer = await store.getCustomerById(complaint.customer_id, orgId);
  if (!customer) throw new Error('Customer not found');

  const bot = await store.getBotById(complaint.bot_id, orgId);
  if (!bot) throw new Error('Originating Telegram bot not found');

  // Record staff message in conversation thread
  const msg = await store.addMessage({
    org_id: orgId,
    complaint_id: complaint.id,
    sender_type: 'agent',
    sender_id: user.id,
    sender_name: user.name,
    message_text: messageText
  });

  // If status was pending, advance to in_progress
  if (complaint.status === 'pending') {
    await store.updateComplaint(complaint.id, { status: 'in_progress' }, orgId, complaintAssigneeScope(user));
  }

  // Send reply directly to customer on Telegram
  try {
    const formattedReply = `💬 Support Update [${complaint.ticket_number}]:\n${messageText}`;
    await sendTelegramReply(readBotToken(bot), complaint.telegram_chat_id ?? customer.telegram_user_id, formattedReply);
  } catch (err) {
    console.error('❌ Failed to dispatch reply to Telegram customer:', err.message);
    // Continue even if Telegram delivery failed so portal thread records it
  }

  return msg;
}
