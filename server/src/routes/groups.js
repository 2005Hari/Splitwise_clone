import { Router } from 'express';
import { z } from 'zod';
import db from '../db/index.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { HttpError } from '../middleware/errorHandler.js';
import { requireAuth, requireGroupMember } from '../middleware/auth.js';
import { logActivity } from '../services/activity.js';
import { computeGroupBalances } from '../services/splitEngine.js';
import { SUPPORTED_CURRENCIES } from '../services/currencies.js';
import { sendPushToUser } from '../services/webPush.js';
import { sendEmail } from '../services/email.js';

const router = Router();
router.use(requireAuth);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const groups = db
      .prepare(
        `SELECT g.id, g.name, g.currency, g.created_at, gm.role
         FROM groups g JOIN group_members gm ON gm.group_id = g.id
         WHERE gm.user_id = ? AND g.kind = 'group'
         ORDER BY g.created_at DESC`
      )
      .all(req.user.id);
    res.json({ groups });
  })
);

const createGroupSchema = z.object({
  name: z.string().trim().min(1).max(120),
  currency: z.enum(SUPPORTED_CURRENCIES).default('INR'),
});

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const { name, currency } = createGroupSchema.parse(req.body);
    const tx = db.transaction(() => {
      const { lastInsertRowid: groupId } = db
        .prepare(`INSERT INTO groups (name, currency, created_by, kind) VALUES (?, ?, ?, 'group')`)
        .run(name, currency, req.user.id);
      db.prepare(
        `INSERT INTO group_members (group_id, user_id, role) VALUES (?, ?, 'owner')`
      ).run(groupId, req.user.id);
      return groupId;
    });
    const groupId = tx();
    res.status(201).json({ group: { id: groupId, name, currency, role: 'owner' } });
  })
);

router.get(
  '/:groupId',
  requireGroupMember,
  asyncHandler(async (req, res) => {
    const group = db
      .prepare('SELECT id, name, kind, currency, created_by, created_at FROM groups WHERE id = ?')
      .get(req.groupId);
    const members = db
      .prepare(
        `SELECT u.id, u.name, u.email, gm.role
         FROM group_members gm JOIN users u ON u.id = gm.user_id
         WHERE gm.group_id = ?
         ORDER BY gm.joined_at ASC`
      )
      .all(req.groupId);
    res.json({ group, members, currentUserRole: req.membership.role });
  })
);

const addMemberSchema = z.object({ email: z.string().trim().toLowerCase().email() });

router.post(
  '/:groupId/members',
  requireGroupMember,
  asyncHandler(async (req, res) => {
    const { email } = addMemberSchema.parse(req.body);
    const user = db.prepare('SELECT id, name, email FROM users WHERE email = ?').get(email);
    if (!user) {
      throw new HttpError(404, 'No account with that email yet — they need to register first');
    }
    const already = db
      .prepare('SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ?')
      .get(req.groupId, user.id);
    if (already) throw new HttpError(409, 'Already a member of this group');

    db.prepare(
      `INSERT INTO group_members (group_id, user_id, role) VALUES (?, ?, 'member')`
    ).run(req.groupId, user.id);
    logActivity(req.groupId, req.user.id, 'member_joined', { userId: user.id, name: user.name });

    const groupName = db.prepare('SELECT name FROM groups WHERE id = ?').get(req.groupId).name;
    sendPushToUser(user.id, {
      title: 'Added to a group',
      body: `${req.user.name} added you to "${groupName}"`,
      tag: `group-${req.groupId}-joined`,
    }).catch((err) => console.warn('push notify failed:', err.message));
    sendEmail({
      to: user.email,
      subject: `You've been added to "${groupName}"`,
      text: `${req.user.name} added you to the group "${groupName}" on Splitwise Clone. Sign in to see the shared expenses.`,
    }).catch((err) => console.warn('email send failed:', err.message));

    res.status(201).json({ member: { ...user, role: 'member' } });
  })
);

// A member leaves the group themselves, or an owner removes someone else.
// Blocked while the person leaving/removed still has a nonzero balance in
// the group — otherwise their share of past expenses becomes uncollectable
// with no record of who it belonged to.
router.delete(
  '/:groupId/members/:userId',
  requireGroupMember,
  asyncHandler(async (req, res) => {
    const targetId = Number(req.params.userId);
    const isSelf = targetId === req.user.id;
    if (!isSelf && req.membership.role !== 'owner') {
      throw new HttpError(403, 'Only the group owner can remove another member');
    }
    const target = db
      .prepare('SELECT u.id, u.name FROM group_members gm JOIN users u ON u.id = gm.user_id WHERE gm.group_id = ? AND gm.user_id = ?')
      .get(req.groupId, targetId);
    if (!target) throw new HttpError(404, 'Not a member of this group');

    const balance = computeGroupBalances(req.groupId).find((b) => b.id === targetId);
    if (balance && balance.netCents !== 0) {
      throw new HttpError(
        400,
        `${target.name} still has an open balance in this group (${balance.netCents > 0 ? 'owed' : 'owes'} money) — settle up first.`
      );
    }

    db.prepare('DELETE FROM group_members WHERE group_id = ? AND user_id = ?').run(req.groupId, targetId);
    logActivity(req.groupId, req.user.id, 'member_left', { userId: targetId, name: target.name, removed: !isSelf });
    res.status(204).end();
  })
);

router.get(
  '/:groupId/activity',
  requireGroupMember,
  asyncHandler(async (req, res) => {
    const rows = db
      .prepare(
        `SELECT a.id, a.type, a.payload, a.created_at, a.actor_id, u.name AS actor_name
         FROM activity_log a JOIN users u ON u.id = a.actor_id
         WHERE a.group_id = ?
         ORDER BY a.created_at DESC
         LIMIT 50`
      )
      .all(req.groupId);
    res.json({ activity: rows.map((r) => ({ ...r, payload: JSON.parse(r.payload) })) });
  })
);

export default router;
