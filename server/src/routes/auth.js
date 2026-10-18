import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import db from '../db/index.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { HttpError } from '../middleware/errorHandler.js';
import { requireAuth, signToken, setSessionCookie, clearSessionCookie } from '../middleware/auth.js';

const router = Router();

const registerSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(8).max(200),
});

router.post(
  '/register',
  asyncHandler(async (req, res) => {
    const { name, email, password } = registerSchema.parse(req.body);

    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
    if (existing) throw new HttpError(409, 'An account with that email already exists');

    const passwordHash = await bcrypt.hash(password, 10);
    const { lastInsertRowid } = db
      .prepare('INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)')
      .run(name, email, passwordHash);

    const user = { id: lastInsertRowid, name, email };
    setSessionCookie(res, signToken(user));
    res.status(201).json({ user });
  })
);

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1),
});

router.post(
  '/login',
  asyncHandler(async (req, res) => {
    const { email, password } = loginSchema.parse(req.body);

    const row = db
      .prepare('SELECT id, name, email, password_hash FROM users WHERE email = ?')
      .get(email);
    if (!row) throw new HttpError(401, 'Invalid email or password');

    const valid = await bcrypt.compare(password, row.password_hash);
    if (!valid) throw new HttpError(401, 'Invalid email or password');

    const user = { id: row.id, name: row.name, email: row.email };
    setSessionCookie(res, signToken(user));
    res.json({ user });
  })
);

router.post('/logout', (req, res) => {
  clearSessionCookie(res);
  res.status(204).end();
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

export default router;
