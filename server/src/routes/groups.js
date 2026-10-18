import { Router } from 'express';
import { z } from 'zod';
import db from '../db/index.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { HttpError } from '../middleware/errorHandler.js';
import { requireAuth, requireGroupMember } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const groups = db
      .prepare(
        `SELECT g.id, g.name, g.created_at, gm.role
         FROM groups g JOIN group_members gm ON gm.group_id = g.id
         WHERE gm.user_id = ?
         ORDER BY g.created_at DESC`
      )
      .all(req.user.id);
    res.json({ groups });
  })
);

const createGroupSchema = z.object({ name: z.string().trim().min(1).max(120) });

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const { name } = createGroupSchema.parse(req.body);
    const tx = db.transaction(() => {
      const { lastInsertRowid: groupId } = db
        .prepare('INSERT INTO groups (name, created_by) VALUES (?, ?)')
        .run(name, req.user.id);
      db.prepare(
        `INSERT INTO group_members (group_id, user_id, role) VALUES (?, ?, 'owner')`
      ).run(groupId, req.user.id);
      return groupId;
    });
    const groupId = tx();
    res.status(201).json({ group: { id: groupId, name, role: 'owner' } });
  })
);

router.get(
  '/:groupId',
  requireGroupMember,
  asyncHandler(async (req, res) => {
    const group = db.prepare('SELECT id, name, created_by, created_at FROM groups WHERE id = ?').get(req.groupId);
    const members = db
      .prepare(
        `SELECT u.id, u.name, u.email, gm.role
         FROM group_members gm JOIN users u ON u.id = gm.user_id
         WHERE gm.group_id = ?
         ORDER BY gm.joined_at ASC`
      )
      .all(req.groupId);
    res.json({ group, members });
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
    res.status(201).json({ member: { ...user, role: 'member' } });
  })
);

export default router;
