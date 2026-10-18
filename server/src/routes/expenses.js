import { Router } from 'express';
import { z } from 'zod';
import db from '../db/index.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { HttpError } from '../middleware/errorHandler.js';
import { requireAuth, requireGroupMember } from '../middleware/auth.js';
import { equalSplit } from '../services/splitEngine.js';

const router = Router({ mergeParams: true });
router.use(requireAuth, requireGroupMember);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const expenses = db
      .prepare(
        `SELECT e.id, e.description, e.amount_cents, e.currency, e.split_type, e.created_at,
                e.paid_by, u.name AS paid_by_name
         FROM expenses e JOIN users u ON u.id = e.paid_by
         WHERE e.group_id = ?
         ORDER BY e.created_at DESC`
      )
      .all(req.groupId);

    const shareStmt = db.prepare(
      `SELECT es.user_id, u.name, es.share_cents
       FROM expense_shares es JOIN users u ON u.id = es.user_id
       WHERE es.expense_id = ?`
    );
    for (const expense of expenses) {
      expense.shares = shareStmt.all(expense.id);
    }
    res.json({ expenses });
  })
);

const baseSchema = z.object({
  description: z.string().trim().min(1).max(200),
  amountCents: z.number().int().positive(),
  paidBy: z.number().int().positive(),
});

const equalExpenseSchema = baseSchema.extend({
  splitType: z.literal('equal'),
  participantIds: z.array(z.number().int().positive()).min(1),
});

const customExpenseSchema = baseSchema.extend({
  splitType: z.literal('custom'),
  shares: z
    .array(z.object({ userId: z.number().int().positive(), shareCents: z.number().int().nonnegative() }))
    .min(1),
});

const expenseSchema = z.discriminatedUnion('splitType', [equalExpenseSchema, customExpenseSchema]);

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const input = expenseSchema.parse(req.body);

    const memberIds = new Set(
      db.prepare('SELECT user_id FROM group_members WHERE group_id = ?').all(req.groupId).map((r) => r.user_id)
    );
    if (!memberIds.has(input.paidBy)) {
      throw new HttpError(400, 'paidBy must be a member of this group');
    }

    let shares;
    if (input.splitType === 'equal') {
      for (const id of input.participantIds) {
        if (!memberIds.has(id)) throw new HttpError(400, `User ${id} is not a member of this group`);
      }
      shares = equalSplit(input.amountCents, input.participantIds);
    } else {
      for (const s of input.shares) {
        if (!memberIds.has(s.userId)) throw new HttpError(400, `User ${s.userId} is not a member of this group`);
      }
      const sum = input.shares.reduce((acc, s) => acc + s.shareCents, 0);
      if (sum !== input.amountCents) {
        throw new HttpError(400, `Shares sum to ${sum} but amount is ${input.amountCents}`);
      }
      shares = input.shares;
    }

    const tx = db.transaction(() => {
      const { lastInsertRowid: expenseId } = db
        .prepare(
          `INSERT INTO expenses (group_id, description, amount_cents, paid_by, created_by, split_type)
           VALUES (?, ?, ?, ?, ?, ?)`
        )
        .run(req.groupId, input.description, input.amountCents, input.paidBy, req.user.id, input.splitType);

      const insertShare = db.prepare(
        'INSERT INTO expense_shares (expense_id, user_id, share_cents) VALUES (?, ?, ?)'
      );
      for (const s of shares) insertShare.run(expenseId, s.userId, s.shareCents);
      return expenseId;
    });

    const expenseId = tx();
    res.status(201).json({ expense: { id: expenseId, ...input, shares } });
  })
);

export default router;
