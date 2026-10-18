import { Router } from 'express';
import { z } from 'zod';
import { ZodError } from 'zod';
import db from '../db/index.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { HttpError } from '../middleware/errorHandler.js';
import { requireAuth, requireGroupMember } from '../middleware/auth.js';
import { logActivity } from '../services/activity.js';
import { expenseSchema, resolveSplit, memberIdSet, createExpense } from '../services/expenseCreation.js';
import { notifyGroupMembers } from '../services/webPush.js';

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
  const receiptCountStmt = db.prepare(
    `SELECT COUNT(*) AS n FROM expense_receipts WHERE expense_id = ?`
  );
  for (const expense of expenses) {
    expense.shares = shareStmt.all(expense.id);
    expense.split_meta = expense.split_meta ? JSON.parse(expense.split_meta) : null;
    expense.comment_count = commentCountStmt.get(expense.id).n;
    expense.receipt_count = receiptCountStmt.get(expense.id).n;
  }
  return expenses;
}

router.get(
  '/',
  asyncHandler(async (req, res) => {
    res.json({ expenses: loadExpenseList(req.groupId) });
  })
);

// createExpense() throws a plain Error for a bad split/member — translate
// that into the 400 an API client expects, same as a zod validation error.
function asHttpBadRequest(err) {
  if (err instanceof ZodError) return new HttpError(400, 'Invalid request');
  return new HttpError(400, err.message);
}

router.post(
  '/',
  asyncHandler(async (req, res) => {
    let result;
    try {
      result = createExpense(req.groupId, req.user.id, req.body);
    } catch (err) {
      throw asHttpBadRequest(err);
    }
    const { expenseId, input, shares, splitMeta, currency } = result;
    res.status(201).json({ expense: { id: expenseId, ...input, currency, shares, splitMeta } });
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

    let input, shares, splitMeta;
    try {
      input = expenseSchema.parse(req.body);
      const memberIds = memberIdSet(req.groupId);
      if (!memberIds.has(input.paidBy)) throw new Error('paidBy must be a member of this group');
      ({ shares, splitMeta } = resolveSplit(input, memberIds));
    } catch (err) {
      throw asHttpBadRequest(err);
    }

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
    notifyGroupMembers(req.groupId, req.user.id, {
      title: `Comment on "${expense.description}"`,
      body: `${req.user.name}: ${body.slice(0, 120)}`,
      tag: `expense-${expense.id}-comments`,
    }).catch((err) => console.warn('push notify failed:', err.message));

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
