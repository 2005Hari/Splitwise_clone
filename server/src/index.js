import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';

import './db/index.js'; // applies schema.sql on boot
import authRoutes from './routes/auth.js';
import groupRoutes from './routes/groups.js';
import expenseRoutes from './routes/expenses.js';
import balanceRoutes from './routes/balances.js';
import settlementRoutes from './routes/settlements.js';
import webhookRoutes from './routes/webhook.js';
import friendRoutes from './routes/friends.js';
import overviewRoutes from './routes/overview.js';
import receiptRoutes from './routes/receipts.js';
import recurringRoutes from './routes/recurring.js';
import pushRoutes from './routes/push.js';
import scanRoutes from './routes/scan.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { EXPENSE_CATEGORIES } from './services/categories.js';
import { startRecurringExpenseScheduler } from './services/scheduler.js';

const app = express();

if (!process.env.JWT_SECRET) {
  console.warn(
    'WARNING: JWT_SECRET is not set. Copy server/.env.example to server/.env and fill it in.'
  );
}

// Running behind a reverse proxy (nginx/Caddy/a PaaS load balancer) in
// production — needed so req.secure and X-Forwarded-* are trusted, which
// in turn makes the `secure: true` session cookie actually get set.
if (process.env.NODE_ENV === 'production') {
  app.set('trust proxy', 1);
}

// contentSecurityPolicy is meant for HTML pages — this is a JSON/file API,
// served from a different origin than the client in most deployments.
// crossOriginResourcePolicy is relaxed so the client can still load receipt
// images directly from the API's /receipts/:id/file URLs.
app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  })
);
app.use(cors({ origin: process.env.CLIENT_ORIGIN || 'http://localhost:5173', credentials: true }));
app.use(cookieParser());

// The YouPI-PG webhook needs the raw body for HMAC verification, so it is
// mounted before the global express.json() parser touches the request.
app.use('/api/payments/webhook', webhookRoutes);

app.use(express.json());

// Slows down credential-stuffing / brute-force attempts against login and
// registration. Generous enough not to bother a real user who mistypes a
// password a few times.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register', authLimiter);

app.get('/api/health', (req, res) => res.json({ ok: true }));
app.get('/api/categories', (req, res) => res.json({ categories: EXPENSE_CATEGORIES }));
app.use('/api/auth', authRoutes);
app.use('/api/groups', groupRoutes);
// More specific /expenses/* paths are mounted before the general
// /expenses router so they're never shadowed by it (Express falls through
// a sub-router with no matching route+method, but mounting order here
// keeps that implicit rather than load-bearing).
app.use('/api/groups/:groupId/expenses/scan', scanRoutes);
app.use('/api/groups/:groupId/expenses/:expenseId/receipts', receiptRoutes);
app.use('/api/groups/:groupId/expenses', expenseRoutes);
app.use('/api/groups/:groupId/balances', balanceRoutes);
app.use('/api/groups/:groupId/settlements', settlementRoutes);
app.use('/api/groups/:groupId/recurring', recurringRoutes);
app.use('/api/friends', friendRoutes);
app.use('/api/overview', overviewRoutes);
app.use('/api/push', pushRoutes);

app.use(notFoundHandler);
app.use(errorHandler);

const port = process.env.PORT || 4000;
app.listen(port, () => {
  console.log(`Splitwise-clone API listening on http://localhost:${port}`);
});

// In-process scheduler for recurring_expenses — see services/scheduler.js
// for why this needs no external cron service.
startRecurringExpenseScheduler();
