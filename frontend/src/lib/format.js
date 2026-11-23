export const STATUS_LABEL = {
  pending: 'Pending',
  in_progress: 'In Progress',
  closed: 'Closed',
  resolved: 'Closed',
};

export const CATEGORY_LABEL = {
  product: 'Product',
  delivery: 'Delivery',
  billing: 'Billing',
  service: 'Service',
  other: 'Other',
};

export const PRIORITY_LABEL = {
  low: 'Low',
  medium: 'Medium',
  normal: 'Medium',
  high: 'High',
  urgent: 'Urgent',
};

export function formatWhen(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatDate(value, options = {}) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    ...options,
  });
}

export function formatTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatMoney(amount, currency = '₹') {
  const n = Number(amount) || 0;
  return `${currency}${n.toLocaleString('en-IN')}`;
}

export function formatNumber(num) {
  if (num === null || num === undefined) return '—';
  return new Intl.NumberFormat().format(num);
}

export function initials(name = '') {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('') || 'RD';
}

export function truncate(str, length = 50) {
  if (!str) return '';
  if (str.length <= length) return str;
  return str.slice(0, length).trim() + '…';
}

export function slugify(str) {
  return str
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function getStatusColor(status) {
  const colors = {
    pending: 'warning',
    in_progress: 'brand',
    closed: 'success',
    resolved: 'success',
  };
  return colors[status] || 'neutral';
}

export function getPriorityColor(priority) {
  const colors = {
    low: 'success',
    normal: 'brand',
    high: 'warning',
    urgent: 'danger',
  };
  return colors[priority] || 'neutral';
}

export function timeAgo(dateString) {
  if (!dateString) return '—';
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return '—';

  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);

  if (seconds < 60) return 'Just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;

  return formatDate(dateString);
}