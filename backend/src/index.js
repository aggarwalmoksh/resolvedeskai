import express from 'express';
import { PORT, ECHO, ENFORCE_SECRET_TOKEN } from './config.js';
import { store } from './db/store.js';

// Route imports
import authRoutes from './routes/authRoutes.js';
import botRoutes from './routes/botRoutes.js';
import complaintRoutes from './routes/complaintRoutes.js';
import dashboardRoutes from './routes/dashboardRoutes.js';
import teamRoutes from './routes/teamRoutes.js';
import subscriptionRoutes from './routes/subscriptionRoutes.js';
import webhookRoutes from './routes/webhookRoutes.js';

const app = express();

// Body Parser
app.use(express.json());

// Native CORS middleware (enables smooth frontend integration)
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization, X-Telegram-Bot-Api-Secret-Token');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// Health check & API Discovery endpoint
app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    service: 'ResolveDesk SaaS Backend API',
    version: '2.0.0',
    endpoints: {
      auth: '/api/auth (register, login, me)',
      bots: '/api/bots (list, link, unlink, sync)',
      complaints: '/api/complaints (list, detail, status, assign, category, reply)',
      dashboard: '/api/dashboard (stats, categories, trends)',
      team: '/api/team (members, invite, accept-invite, permissions)',
      subscription: '/api/subscription (plans, upgrade)',
      telegramWebhook: '/telegram/webhook/:botId'
    },
    state: {
      organizations_count: store._coll('organizations').length,
      linked_bots_count: store._coll('bots').length,
      complaints_count: store._coll('complaints').length
    }
  });
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/bots', botRoutes);
app.use('/api/complaints', complaintRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/team', teamRoutes);
app.use('/api/subscription', subscriptionRoutes);

// Telegram Webhook Routes (Dynamic per bot)
app.use('/telegram', webhookRoutes);

// 404 handler for unmatched routes
app.use((req, res) => {
  res.status(404).json({ error: `Route not found: ${req.method} ${req.originalUrl}` });
});

// Global Error Handler
app.use((err, req, res, next) => {
  console.error('Unhandled server error:', err);
  res.status(500).json({ error: 'Internal server error', message: err.message });
});

app.listen(PORT, () => {
  console.log(`\n=============================================================`);
  console.log(`🚀 ResolveDesk SaaS Backend running on port ${PORT}`);
  console.log(`📊 Health Check & Discovery: http://localhost:${PORT}/`);
  console.log(`🤖 Dynamic Bot Webhooks: http://localhost:${PORT}/telegram/webhook/:botId`);
  console.log(`🔒 Secret token verification: ${ENFORCE_SECRET_TOKEN ? 'STRICT (401 on mismatch)' : 'PERMISSIVE (warn on mismatch)'}`);
  console.log(`💾 Local store loaded from: ${store.isLoaded ? '.data/db.json' : 'in-memory'}`);
  console.log(`=============================================================\n`);
});

export default app;