// The validated-split-to-database-rows logic shared by a one-off expense
// (routes/expenses.js) and a recurring expense firing (services/scheduler.js).
// Deliberately HTTP-agnostic: throws plain Error on invalid input so the
// scheduler can catch and pause a template instead of crashing, while the
// Express route wraps the same Error into a 400 for the client.
import { z } from 'zod';
import db from '../db/index.js';
import { equalSplit, proportionalSplit } from './splitEngine.js';
import { logActivity } from './activity.js';
import { CATEGORY_IDS } from './categories.js';
import { notifyGroupMembers } from './webPush.js';
import { formatMoney } from '../utils/money.js';

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

export const expenseSchema = z.discriminatedUnion('splitType', [
  equalExpenseSchema,
  exactExpenseSchema,
  percentageExpenseSchema,
  sharesExpenseSchema,
]);

export function memberIdSet(groupId) {
  return new Set(
    db.prepare('SELECT user_id FROM group_members WHERE group_id = ?').all(groupId).map((r) => r.user_id)
  );
}

// Turns a validated request body into { shares, splitMeta }, checking every
// referenced user is actually a member of the group.
export function resolveSplit(input, memberIds) {
  const checkMember = (id) => {
    if (!memberIds.has(id)) throw new Error(`User ${id} is not a member of this group`);
  };

  if (input.splitType === 'equal') {
    input.participantIds.forEach(checkMember);
    return { shares: equalSplit(input.amountCents, input.participantIds), splitMeta: null };
  }

  if (input.splitType === 'exact') {
    input.exactShares.forEach((s) => checkMember(s.userId));
    const sum = input.exactShares.reduce((acc, s) => acc + s.shareCents, 0);
    if (sum !== input.amountCents) {
      throw new Error(`Shares sum to ${sum} but amount is ${input.amountCents}`);
    }
    return { shares: input.exactShares, splitMeta: { type: 'exact' } };
  }

  if (input.splitType === 'percentage') {
    input.percentages.forEach((p) => checkMember(p.userId));
    const total = input.percentages.reduce((acc, p) => acc + p.percent, 0);
    if (Math.abs(total - 100) > 0.01) {
      throw new Error(`Percentages sum to ${total.toFixed(2)}, not 100`);
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

/**
 * Validates and inserts one expense + its shares, logs the activity entry,
 * and returns the new expense id. Throws a plain Error on invalid input
 * (unknown member, bad split) — callers decide how to surface that.
 */
export function createExpense(groupId, actorId, rawInput, { activityType = 'expense_added', activityNote } = {}) {
  const input = expenseSchema.parse(rawInput);
  const memberIds = memberIdSet(groupId);
  if (!memberIds.has(input.paidBy)) throw new Error('paidBy must be a member of this group');

  const { shares, splitMeta } = resolveSplit(input, memberIds);
  const groupCurrency = db.prepare('SELECT currency FROM groups WHERE id = ?').get(groupId).currency;

  const tx = db.transaction(() => {
    const { lastInsertRowid: expenseId } = db
      .prepare(
        `INSERT INTO expenses (group_id, description, amount_cents, currency, category, paid_by, created_by, split_type, split_meta)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        groupId,
        input.description,
        input.amountCents,
        groupCurrency,
        input.category,
        input.paidBy,
        actorId,
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
  logActivity(groupId, actorId, activityType, {
    expenseId,
    description: input.description,
    amountCents: input.amountCents,
    currency: groupCurrency,
    ...(activityNote ? { note: activityNote } : {}),
  });

  if (activityType === 'expense_added') {
    const actorName = db.prepare('SELECT name FROM users WHERE id = ?').get(actorId)?.name || 'Someone';
    notifyGroupMembers(groupId, actorId, {
      title: input.description,
      body: `${actorName} added ${formatMoney(input.amountCents, groupCurrency)}${activityNote ? ` (${activityNote})` : ''}`,
      tag: `expense-${expenseId}`,
    }).catch((err) => console.warn('push notify failed:', err.message));
  }

  return { expenseId, input, shares, splitMeta, currency: groupCurrency };
}
