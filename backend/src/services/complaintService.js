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
      keywords: ['flower', 'wilted', 'damaged', 'broken', 'quality', 'wrong item', 'bouquet', 'decayed', 'stale', 'smell', 'rotten', 'fresh']
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
 * Ingest incoming Telegram message from webhook
 */
export async function ingestTelegramMessage(bot, telegramMessage) {
  const from = telegramMessage.from;
  if (!from) return null;

  const text = telegramMessage.text || (telegramMessage.caption ? `[Media]: ${telegramMessage.caption}` : '[Non-text message]');
  const messageId = telegramMessage.message_id;

  // 1. Upsert Customer Record
  const customer = await store.getOrCreateCustomer({
    org_id: bot.org_id,
    telegram_user_id: from.id,
    username: from.username,
    first_name: from.first_name,
    last_name: from.last_name,
    phone: telegramMessage.contact?.phone_number || null
  });

  // 2. Check for an active open ticket for this customer
  let complaint = store.getActiveComplaintForCustomer(bot.org_id, customer.id);
  let isNewTicket = false;

  if (!complaint) {
    isNewTicket = true;
    const category = detectCategory(text);
    const titleSnippet = text.length > 50 ? `${text.substring(0, 47)}...` : text;

    complaint = await store.createComplaint({
      org_id: bot.org_id,
      bot_id: bot.id,
      customer_id: customer.id,
      title: titleSnippet || 'New Complaint',
      description: text,
      category,
      priority: 'medium'
    });
  } else {
    await store.updateComplaint(complaint.id, {
      description: `${complaint.description}\n---\n[Update]: ${text}`
    }, bot.org_id);
  }

  // 3. Append to Conversation Thread
  const senderDisplayName = [customer.first_name, customer.last_name].filter(Boolean).join(' ') || customer.username || 'Customer';
  await store.addMessage({
    complaint_id: complaint.id,
    sender_type: 'customer',
    sender_id: customer.id,
    sender_name: senderDisplayName,
    message_text: text,
    telegram_message_id: messageId
  });

  // 4. Send automated acknowledgment on new ticket
  if (isNewTicket) {
    try {
      const ackText = `🌸 Hello! We have received your complaint [${complaint.ticket_number}].\nOur team is reviewing it and will respond here shortly.`;
      await sendTelegramReply(bot.bot_token, customer.telegram_user_id, ackText, messageId);
      console.log(`📤 [Telegram Reply] Sent auto-acknowledgment for ticket [${complaint.ticket_number}] to user ${customer.telegram_user_id}`);
    } catch (err) {
      console.warn('⚠️ Could not send automated acknowledgment to customer:', err.message);
    }
  }

  return { complaint, isNewTicket };
}

/**
 * Staff reply to customer - saves in thread & dispatches to Telegram
 */
export async function replyToComplaint({ complaintId, orgId, user, messageText }) {
  const complaint = store.getComplaintById(complaintId, orgId);
  if (!complaint) throw new Error('Complaint not found');

  const customer = store.getCustomerById(complaint.customer_id);
  if (!customer) throw new Error('Customer not found');

  const bot = store.getBotById(complaint.bot_id);
  if (!bot) throw new Error('Originating Telegram bot not found');

  // Record staff message in conversation thread
  const msg = await store.addMessage({
    complaint_id: complaint.id,
    sender_type: 'agent',
    sender_id: user.id,
    sender_name: user.name,
    message_text: messageText
  });

  // If status was pending, advance to in_progress
  if (complaint.status === 'pending') {
    await store.updateComplaint(complaint.id, { status: 'in_progress' }, orgId);
  }

  // Send reply directly to customer on Telegram
  try {
    const formattedReply = `💬 Support Update [${complaint.ticket_number}]:\n${messageText}`;
    await sendTelegramReply(bot.bot_token, customer.telegram_user_id, formattedReply);
  } catch (err) {
    console.error('❌ Failed to dispatch reply to Telegram customer:', err.message);
    // Continue even if Telegram delivery failed so portal thread records it
  }

  return msg;
}
