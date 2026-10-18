import { Router } from 'express';
import { z } from 'zod';
import db from '../db/index.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { HttpError } from '../middleware/errorHandler.js';
import { requireAuth, requireGroupMember } from '../middleware/auth.js';
import { equalSplit, proportionalSplit } from '../services/splitEngine.js';
import { logActivity } from '../services/activity.js';
import { CATEGORY_IDS } from '../services/categories.js';

const router = Router({ mergeParams: true });
router.use(requireAuth, requireGroupMember);

function loadExpenseList(groupId) {
  const expenses = db
    .prepare(
      `SELECT e.id, e.description, e.amount_cents, e.currency, e.category, e.split_type,
              e.split_meta, e.created_at, e.updated_at,
              e.paid_by, u.name AS paid_by_name,
              e.created_by, cu.name AS created_by_name
       FROM expenses e
       JOIN users u ON u.id = e.paid_by
       JOIN users cu ON cu.id = e.created_by
       WHERE e.group_id = ? AND e.deleted_at IS NULL
       ORDER BY e.created_at DESC`
    )
    .all(groupId);

  const shareStmt = db.prepare(
    `SELECT es.user_id, u.name, es.share_cents
     FROM expense_shares es JOIN users u ON u.id = es.user_id
     WHERE es.expense_id = ?`
  );
  const commentCountStmt = db.prepare(
    `SELECT COUNT(*) AS n FROM expense_comments WHERE expense_id = ?`
  );
  for (const expense of expenses) {
    expense.shares = shareStmt.all(expense.id);
    expense.split_meta = expense.split_meta ? JSON.parse(expense.split_meta) : null;
    expense.comment_count = commentCountStmt.get(expense.id).n;
  }
  return expenses;
}

router.get(
  '/',
  asyncHandler(async (req, res) => {
    res.json({ expenses: loadExpenseList(req.groupId) });
  })
);

const baseSchema = z.object({
  description: z.string().trim().min(1).max(200),
  amountCents: z.number().int().positive(),
  paidBy: z.number().int().positive(),
  category: z.enum(CATEGORY_IDS).default('general'),
});

const equalExpenseSchema = baseSchema.extend({
  splitType: z.literal('equal'),
  participantIds: z.array(z.number().int().positive()).min(1),
});

const exactExpenseSchema = baseSchema.extend({
  splitType: z.literal('exact'),
  exactShares: z
    .array(z.object({ userId: z.number().int().positive(), shareCents: z.number().int().nonnegative() }))
    .min(1),
});

const percentageExpenseSchema = baseSchema.extend({
  splitType: z.literal('percentage'),
  percentages: z
    .array(z.object({ userId: z.number().int().positive(), percent: z.number().positive().max(100) }))
    .min(1),
});

const sharesExpenseSchema = baseSchema.extend({
  splitType: z.literal('shares'),
  shareWeights: z
    .array(z.object({ userId: z.number().int().positive(), shares: z.number().positive() }))
    .min(1),
});

const expenseSchema = z.discriminatedUnion('splitType', [
  equalExpenseSchema,
  exactExpenseSchema,
  percentageExpenseSchema,
  sharesExpenseSchema,
]);

// Turns a validated request body into { shares, splitMeta }, checking every
// referenced user is actually a member of the group.
function resolveSplit(input, memberIds) {
  const checkMember = (id) => {
    if (!memberIds.has(id)) throw new HttpError(400, `User ${id} is not a member of this group`);
  };

  if (input.splitType === 'equal') {
    input.participantIds.forEach(checkMember);
    return { shares: equalSplit(input.amountCents, input.participantIds), splitMeta: null };
  }

  if (input.splitType === 'exact') {
    input.exactShares.forEach((s) => checkMember(s.userId));
    const sum = input.exactShares.reduce((acc, s) => acc + s.shareCents, 0);
    if (sum !== input.amountCents) {
      throw new HttpError(400, `Shares sum to ${sum} but amount is ${input.amountCents}`);
    }
    return { shares: input.exactShares, splitMeta: { type: 'exact' } };
  }

  if (input.splitType === 'percentage') {
    input.percentages.forEach((p) => checkMember(p.userId));
    const total = input.percentages.reduce((acc, p) => acc + p.percent, 0);
    if (Math.abs(total - 100) > 0.01) {
      throw new HttpError(400, `Percentages sum to ${total.toFixed(2)}, not 100`);
    }
    const shares = proportionalSplit(
      input.amountCents,
      input.percentages.map((p) => ({ userId: p.userId, weight: p.percent }))
    );
    return { shares, splitMeta: { type: 'percentage', values: input.percentages } };
  }

  // shares (ratio)
  input.shareWeights.forEach((w) => checkMember(w.userId));
  const shares = proportionalSplit(
    input.amountCents,
    input.shareWeights.map((w) => ({ userId: w.userId, weight: w.shares }))
  );
  return { shares, splitMeta: { type: 'shares', values: input.shareWeights } };
}

function memberIdSet(groupId) {
  return new Set(
    db.prepare('SELECT user_id FROM group_members WHERE group_id = ?').all(groupId).map((r) => r.user_id)
  );
}

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const input = expenseSchema.parse(req.body);
    const memberIds = memberIdSet(req.groupId);
    if (!memberIds.has(input.paidBy)) throw new HttpError(400, 'paidBy must be a member of this group');

    const { shares, splitMeta } = resolveSplit(input, memberIds);
    const groupCurrency = db.prepare('SELECT currency FROM groups WHERE id = ?').get(req.groupId).currency;

    const tx = db.transaction(() => {
      const { lastInsertRowid: expenseId } = db
        .prepare(
          `INSERT INTO expenses (group_id, description, amount_cents, currency, category, paid_by, created_by, split_type, split_meta)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          req.groupId,
          input.description,
          input.amountCents,
          groupCurrency,
          input.category,
          input.paidBy,
          req.user.id,
          input.splitType,
          splitMeta ? JSON.stringify(splitMeta) : null
        );

      const insertShare = db.prepare(
        'INSERT INTO expense_shares (expense_id, user_id, share_cents) VALUES (?, ?, ?)'
      );
      for (const s of shares) insertShare.run(expenseId, s.userId, s.shareCents);
      return expenseId;
    });

    const expenseId = tx();
    logActivity(req.groupId, req.user.id, 'expense_added', {
      expenseId,
      description: input.description,
      amountCents: input.amountCents,
      currency: groupCurrency,
    });
    res.status(201).json({ expense: { id: expenseId, ...input, currency: groupCurrency, shares, splitMeta } });
  })
);

function loadOwnedExpense(expenseId, groupId) {
  const expense = db
    .prepare('SELECT * FROM expenses WHERE id = ? AND group_id = ? AND deleted_at IS NULL')
    .get(expenseId, groupId);
  if (!expense) throw new HttpError(404, 'Expense not found');
  return expense;
}

router.patch(
  '/:expenseId',
  asyncHandler(async (req, res) => {
    const existing = loadOwnedExpense(req.params.expenseId, req.groupId);
    const input = expenseSchema.parse(req.body);
    const memberIds = memberIdSet(req.groupId);
    if (!memberIds.has(input.paidBy)) throw new HttpError(400, 'paidBy must be a member of this group');

    const { shares, splitMeta } = resolveSplit(input, memberIds);

    const tx = db.transaction(() => {
      db.prepare(
        `UPDATE expenses SET description = ?, amount_cents = ?, category = ?, paid_by = ?,
                              split_type = ?, split_meta = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
         WHERE id = ?`
      ).run(
        input.description,
        input.amountCents,
        input.category,
        input.paidBy,
        input.splitType,
        splitMeta ? JSON.stringify(splitMeta) : null,
        existing.id
      );
      db.prepare('DELETE FROM expense_shares WHERE expense_id = ?').run(existing.id);
      const insertShare = db.prepare(
        'INSERT INTO expense_shares (expense_id, user_id, share_cents) VALUES (?, ?, ?)'
      );
      for (const s of shares) insertShare.run(existing.id, s.userId, s.shareCents);
    });
    tx();

    logActivity(req.groupId, req.user.id, 'expense_updated', {
      expenseId: existing.id,
      description: input.description,
      amountCents: input.amountCents,
    });
    res.json({ expense: { id: existing.id, ...input, currency: existing.currency, shares, splitMeta } });
  })
);

router.delete(
  '/:expenseId',
  asyncHandler(async (req, res) => {
    const existing = loadOwnedExpense(req.params.expenseId, req.groupId);
    db.prepare(
      `UPDATE expenses SET deleted_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`
    ).run(existing.id);
    logActivity(req.groupId, req.user.id, 'expense_deleted', {
      expenseId: existing.id,
      description: existing.description,
      amountCents: existing.amount_cents,
    });
    res.status(204).end();
  })
);

const commentSchema = z.object({ body: z.string().trim().min(1).max(2000) });

router.get(
  '/:expenseId/comments',
  asyncHandler(async (req, res) => {
    loadOwnedExpense(req.params.expenseId, req.groupId);
    const comments = db
      .prepare(
        `SELECT c.id, c.body, c.created_at, c.user_id, u.name AS user_name
         FROM expense_comments c JOIN users u ON u.id = c.user_id
         WHERE c.expense_id = ? ORDER BY c.created_at ASC`
      )
      .all(req.params.expenseId);
    res.json({ comments });
  })
);

router.post(
  '/:expenseId/comments',
  asyncHandler(async (req, res) => {
    const expense = loadOwnedExpense(req.params.expenseId, req.groupId);
    const { body } = commentSchema.parse(req.body);
    const { lastInsertRowid } = db
      .prepare('INSERT INTO expense_comments (expense_id, user_id, body) VALUES (?, ?, ?)')
      .run(expense.id, req.user.id, body);

    logActivity(req.groupId, req.user.id, 'comment_added', {
      expenseId: expense.id,
      description: expense.description,
      preview: body.slice(0, 80),
    });

    const comment = db
      .prepare(
        `SELECT c.id, c.body, c.created_at, c.user_id, u.name AS user_name
         FROM expense_comments c JOIN users u ON u.id = c.user_id WHERE c.id = ?`
      )
      .get(lastInsertRowid);
    res.status(201).json({ comment });
  })
);

export default router;
