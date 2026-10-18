import { Router } from 'express';
import { z } from 'zod';
import db from '../db/index.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { HttpError } from '../middleware/errorHandler.js';
import { requireAuth, requireGroupMember } from '../middleware/auth.js';
import { expenseSchema, resolveSplit, memberIdSet } from '../services/expenseCreation.js';
import { computeNextRunAt } from '../services/scheduler.js';
import { logActivity } from '../services/activity.js';

const router = Router({ mergeParams: true });
router.use(requireAuth, requireGroupMember);

// Only the fields resolveSplit() actually needs to replay the split later —
// description/amountCents/paidBy/category/splitType are columns of their own.
function splitConfigOf(input) {
  const { description, amountCents, paidBy, category, splitType, ...rest } = input;
  return rest;
}

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const rows = db
      .prepare(
        `SELECT r.*, u.name AS paid_by_name
         FROM recurring_expenses r JOIN users u ON u.id = r.paid_by
         WHERE r.group_id = ? ORDER BY r.created_at DESC`
      )
      .all(req.groupId);
    res.json({
      recurring: rows.map((r) => ({ ...r, split_config: JSON.parse(r.split_config), active: !!r.active })),
    });
  })
);

const frequencySchema = z.enum(['daily', 'weekly', 'monthly']);

router.post(
  '/',
  asyncHandler(async (req, res) => {
    let input;
    try {
      input = expenseSchema.parse(req.body);
      const frequency = frequencySchema.parse(req.body.frequency);
      const memberIds = memberIdSet(req.groupId);
      if (!memberIds.has(input.paidBy)) throw new Error('paidBy must be a member of this group');
      resolveSplit(input, memberIds); // validate now so a broken template is never saved

      const nextRunAt = computeNextRunAt(frequency, new Date().toISOString());
      const { lastInsertRowid } = db
        .prepare(
          `INSERT INTO recurring_expenses
             (group_id, description, amount_cents, category, paid_by, created_by, split_type, split_config, frequency, next_run_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          req.groupId,
          input.description,
          input.amountCents,
          input.category,
          input.paidBy,
          req.user.id,
          input.splitType,
          JSON.stringify(splitConfigOf(input)),
          frequency,
          nextRunAt
        );

      logActivity(req.groupId, req.user.id, 'expense_added', {
        expenseId: null,
        description: `${input.description} (recurring, ${frequency})`,
        amountCents: input.amountCents,
        note: `set up to repeat ${frequency}, starting ${nextRunAt.slice(0, 10)}`,
      });

      res.status(201).json({ id: lastInsertRowid, nextRunAt });
    } catch (err) {
      throw new HttpError(400, err.message || 'Invalid recurring expense');
    }
  })
);

const updateSchema = z.object({ active: z.boolean() });

router.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const { active } = updateSchema.parse(req.body);
    const existing = db
      .prepare('SELECT id FROM recurring_expenses WHERE id = ? AND group_id = ?')
      .get(req.params.id, req.groupId);
    if (!existing) throw new HttpError(404, 'Recurring expense not found');

    db.prepare('UPDATE recurring_expenses SET active = ? WHERE id = ?').run(active ? 1 : 0, existing.id);
    res.json({ ok: true });
  })
);

router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const existing = db
      .prepare('SELECT id FROM recurring_expenses WHERE id = ? AND group_id = ?')
      .get(req.params.id, req.groupId);
    if (!existing) throw new HttpError(404, 'Recurring expense not found');
    db.prepare('DELETE FROM recurring_expenses WHERE id = ?').run(existing.id);
    res.status(204).end();
  })
);

export default router;
