import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';

import './db/index.js'; // applies schema.sql on boot
import authRoutes from './routes/auth.js';
import groupRoutes from './routes/groups.js';
import expenseRoutes from './routes/expenses.js';
import balanceRoutes from './routes/balances.js';
import settlementRoutes from './routes/settlements.js';
import webhookRoutes from './routes/webhook.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';

const app = express();

if (!process.env.JWT_SECRET) {
  console.warn(
    'WARNING: JWT_SECRET is not set. Copy server/.env.example to server/.env and fill it in.'
  );
}

app.use(cors({ origin: process.env.CLIENT_ORIGIN || 'http://localhost:5173', credentials: true }));
app.use(cookieParser());

// The YouPI-PG webhook needs the raw body for HMAC verification, so it is
// mounted before the global express.json() parser touches the request.
app.use('/api/payments/webhook', webhookRoutes);

app.use(express.json());

app.get('/api/health', (req, res) => res.json({ ok: true }));
app.use('/api/auth', authRoutes);
app.use('/api/groups', groupRoutes);
app.use('/api/groups/:groupId/expenses', expenseRoutes);
app.use('/api/groups/:groupId/balances', balanceRoutes);
app.use('/api/groups/:groupId/settlements', settlementRoutes);

app.use(notFoundHandler);
app.use(errorHandler);

const port = process.env.PORT || 4000;
app.listen(port, () => {
  console.log(`Splitwise-clone API listening on http://localhost:${port}`);
});
