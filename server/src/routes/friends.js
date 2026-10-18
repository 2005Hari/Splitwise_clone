import { Router } from 'express';
import { z } from 'zod';
import db from '../db/index.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { HttpError } from '../middleware/errorHandler.js';
import { requireAuth } from '../middleware/auth.js';
import { listCounterparties, friendBalanceByCurrency, friendGroupBreakdown } from '../services/splitEngine.js';

const router = Router();
router.use(requireAuth);

// The hidden 2-person group a friend pair's direct (not-in-a-named-group)
// expenses live in. Created the first time it's actually needed.
function getOrCreateDirectGroup(userId, otherUserId) {
  const existing = db
    .prepare(
      `SELECT g.id FROM groups g
       JOIN group_members gm1 ON gm1.group_id = g.id AND gm1.user_id = ?
       JOIN group_members gm2 ON gm2.group_id = g.id AND gm2.user_id = ?
       WHERE g.kind = 'friend'
       LIMIT 1`
    )
    .get(userId, otherUserId);
  if (existing) return existing.id;

  const tx = db.transaction(() => {
    const { lastInsertRowid: groupId } = db
      .prepare(`INSERT INTO groups (name, kind, currency, created_by) VALUES (NULL, 'friend', 'INR', ?)`)
      .run(userId);
    const addMember = db.prepare(`INSERT INTO group_members (group_id, user_id, role) VALUES (?, ?, 'member')`);
    addMember.run(groupId, userId);
    addMember.run(groupId, otherUserId);
    return groupId;
  });
  return tx();
}

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const counterparties = listCounterparties(req.user.id);
    const friends = counterparties.map((f) => ({
      ...f,
      balances: friendBalanceByCurrency(req.user.id, f.id),
    }));
    res.json({ friends });
  })
);

const addFriendSchema = z.object({ email: z.string().trim().toLowerCase().email() });

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const { email } = addFriendSchema.parse(req.body);
    if (email === req.user.email) throw new HttpError(400, 'That is your own account');
    const friend = db.prepare('SELECT id, name, email FROM users WHERE email = ?').get(email);
    if (!friend) throw new HttpError(404, 'No account with that email yet — they need to register first');

    const groupId = getOrCreateDirectGroup(req.user.id, friend.id);
    res.status(201).json({ friend, groupId });
  })
);

router.get(
  '/:userId',
  asyncHandler(async (req, res) => {
    const otherId = Number(req.params.userId);
    const known = listCounterparties(req.user.id).some((f) => f.id === otherId);
    if (!known) throw new HttpError(404, 'Not a friend yet');

    const friend = db.prepare('SELECT id, name, email FROM users WHERE id = ?').get(otherId);
    const balances = friendBalanceByCurrency(req.user.id, otherId);
    const groups = friendGroupBreakdown(req.user.id, otherId);
    res.json({ friend, balances, groups });
  })
);

router.post(
  '/:userId/direct-group',
  asyncHandler(async (req, res) => {
    const otherId = Number(req.params.userId);
    const friend = db.prepare('SELECT id, name, email FROM users WHERE id = ?').get(otherId);
    if (!friend) throw new HttpError(404, 'No such user');
    const groupId = getOrCreateDirectGroup(req.user.id, otherId);
    res.status(201).json({ groupId });
  })
);

export default router;
