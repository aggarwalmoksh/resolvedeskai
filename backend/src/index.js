import express from 'express';
import { clerkMiddleware } from '@clerk/express';
import {
  PORT,
  PUBLIC_BASE_URL,
  SUPABASE_URL,
  CORS_ORIGINS,
  CLERK_SECRET_KEY,
  CLERK_PUBLISHABLE_KEY
} from './config.js';

// Route imports
import authRoutes from './routes/authRoutes.js';
import botRoutes from './routes/botRoutes.js';
import complaintRoutes from './routes/complaintRoutes.js';
import dashboardRoutes from './routes/dashboardRoutes.js';
import teamRoutes from './routes/teamRoutes.js';
import subscriptionRoutes from './routes/subscriptionRoutes.js';
import { telegramWorkerReady, wakeTelegramWorker } from './services/telegramWorker.js';
import workspaceEvents from './routes/workspaceEvents.js';
import webhookRoutes from './routes/webhookRoutes.js';

const app = express();

// Body Parser
app.use(express.json());

// Native CORS middleware (enables smooth frontend integration)
app.use((req, res, next) => {
  const origin = req.get('origin')?.replace(/\/$/, '');
  const isDev = process.env.NODE_ENV !== 'production';
  if (origin && (CORS_ORIGINS.includes(origin) || (isDev && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)))) {
    res.header('Access-Control-Allow-Origin', origin);
    res.header('Vary', 'Origin');
  }
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization, Idempotency-Key, X-Telegram-Bot-Api-Secret-Token');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

app.get('/ready', (req, res) => {
  const ready = telegramWorkerReady();
  res.set('Cache-Control', 'no-store');
  res.status(ready ? 200 : 503).json({ status: ready ? 'ready' : 'not_ready' });
});

app.use(clerkMiddleware({
  secretKey: CLERK_SECRET_KEY,
  publishableKey: CLERK_PUBLISHABLE_KEY
}));

// Health check & API Discovery endpoint
app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    service: 'ResolveDesk SaaS Backend API',
    version: '2.0.0',
    endpoints: {
      auth: '/api/auth (onboard-business, complete-invitation, me)',
      bots: '/api/bots (list, link, unlink, sync)',
      complaints: '/api/complaints (list, detail, status, assign, category, reply)',
      dashboard: '/api/dashboard (stats, categories, trends)',
      team: '/api/team (members, invite, accept-invite, permissions)',
      subscription: '/api/subscription (plans, upgrade)',
      telegramWebhook: '/telegram/webhook'
    },
    state: { persistence: 'Supabase only', authentication: 'Clerk' }
  });
});

// API Routes
app.use('/api/workspace-events', workspaceEvents);
app.use('/api/auth', authRoutes);
app.use('/api/bots', botRoutes);
app.use('/api/complaints', complaintRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/team', teamRoutes);
app.use('/api/subscription', subscriptionRoutes);

// Telegram Webhook Routes (Dynamic per bot and legacy default)
app.use('/telegram', webhookRoutes);

// 404 handler for unmatched routes
app.use((req, res) => {
  res.status(404).json({ error: `Route not found: ${req.method} ${req.originalUrl}` });
});

// Global Error Handler
app.use((err, req, res, next) => {
  console.error('Unhandled server error:', err);
  const isProduction = process.env.NODE_ENV === 'production';
  res.status(err.statusCode || 500).json({
    error: isProduction ? 'Internal server error' : (err.message || 'Internal server error'),
    ...(isProduction ? {} : { details: err.errors?.map(item => item.message || item.code) })
  });
});

const server = app.listen(PORT, async () => {
  console.log(`\n=============================================================`);
  console.log(`🚀 ResolveDesk SaaS Backend running on port ${PORT}`);
  console.log(`📊 Health Check & Discovery: http://localhost:${PORT}/`);
  console.log(`🤖 Telegram Webhook Endpoint: http://localhost:${PORT}/telegram/webhook`);
  if (PUBLIC_BASE_URL) {
    console.log(`🌐 Public Webhook URL     : ${PUBLIC_BASE_URL.replace(/\/+$/, '')}/telegram/webhook`);
  }
  console.log(`⚡ Supabase Database       : ${SUPABASE_URL ? 'CONFIGURED (' + SUPABASE_URL + ')' : 'NOT CONFIGURED'}`);
  console.log(`💾 Persistence             : Supabase only (no local fallback)`);
  console.log(`=============================================================`);

  console.log(`Readiness check: http://localhost:${PORT}/ready`);
});

const workerInterval = setInterval(wakeTelegramWorker, 2000);
workerInterval.unref();
server.on('listening', wakeTelegramWorker);
server.on('close', () => clearInterval(workerInterval));

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`❌ [Server] Port ${PORT} is already occupied by another process. Please terminate it (e.g. 'kill -9 $(lsof -ti:${PORT})') and restart.`);
    process.exit(1);
  } else {
    throw err;
  }
});

export default app;
