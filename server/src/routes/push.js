import { Router } from 'express';
import { z } from 'zod';
import db from '../db/index.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { requireAuth } from '../middleware/auth.js';
import { VAPID_PUBLIC_KEY } from '../services/webPush.js';

const router = Router();

// Public key only — safe to expose, it's what the client's
// pushManager.subscribe() needs; the private key never leaves the server.
router.get('/vapid-public-key', (req, res) => res.json({ publicKey: VAPID_PUBLIC_KEY }));

router.use(requireAuth);

const subscribeSchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({ p256dh: z.string().min(1), auth: z.string().min(1) }),
});

router.post(
  '/subscribe',
  asyncHandler(async (req, res) => {
    const { endpoint, keys } = subscribeSchema.parse(req.body);
    db.prepare(
      `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth) VALUES (?, ?, ?, ?)
       ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth`
    ).run(req.user.id, endpoint, keys.p256dh, keys.auth);
    res.status(201).json({ ok: true });
  })
);

const unsubscribeSchema = z.object({ endpoint: z.string().url() });

router.post(
  '/unsubscribe',
  asyncHandler(async (req, res) => {
    const { endpoint } = unsubscribeSchema.parse(req.body);
    db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?').run(endpoint, req.user.id);
    res.status(204).end();
  })
);

export default router;
