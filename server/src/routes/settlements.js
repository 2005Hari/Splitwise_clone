import { Router } from 'express';
import { z } from 'zod';
import db from '../db/index.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { HttpError } from '../middleware/errorHandler.js';
import { requireAuth, requireGroupMember } from '../middleware/auth.js';
import { createYoupiPayment } from '../services/youpiClient.js';
import { centsToRupeeString } from '../utils/money.js';
import { computeGroupBalances } from '../services/splitEngine.js';
import { logActivity } from '../services/activity.js';

const router = Router({ mergeParams: true });
router.use(requireAuth, requireGroupMember);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const rows = db
      .prepare(
        `SELECT s.id, s.amount_cents, s.currency, s.status, s.source, s.note, s.utr, s.method,
                s.created_at, s.completed_at,
                s.payer_id, payer.name AS payer_name,
                s.payee_id, payee.name AS payee_name
         FROM settlements s
         JOIN users payer ON payer.id = s.payer_id
         JOIN users payee ON payee.id = s.payee_id
         WHERE s.group_id = ?
         ORDER BY s.created_at DESC`
      )
      .all(req.groupId);
    res.json({ settlements: rows });
  })
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const row = db
      .prepare(
        `SELECT id, amount_cents, currency, status, source, note, utr, method, created_at, completed_at,
                payer_id, payee_id, youpi_checkout_url
         FROM settlements WHERE id = ? AND group_id = ?`
      )
      .get(req.params.id, req.groupId);
    if (!row) throw new HttpError(404, 'Settlement not found');
    res.json({ settlement: row });
  })
);

const createSettlementSchema = z.object({
  payeeId: z.number().int().positive(),
  amountCents: z.number().int().positive(),
  source: z.enum(['youpi', 'cash']).default('youpi'),
  note: z.string().trim().max(500).optional(),
});

// Validated against each person's overall net balance in the group, not the
// direct pairwise history between just these two people: the "suggested
// payments" list is a *simplified* debt graph (minimum number of payments
// to settle everyone up), so it routinely suggests paying someone you have
// no prior direct expense with — their net balances still make that a real,
// correct payment. Checking a direct pairwise balance here would reject the
// exact transfer the UI just suggested.
function requireActualDebt(groupId, payerId, payeeId) {
  const balances = computeGroupBalances(groupId);
  const payer = balances.find((b) => b.id === payerId);
  const payee = balances.find((b) => b.id === payeeId);
  if (!payer || payer.netCents >= 0) {
    throw new HttpError(400, 'You are not currently in debt in this group, so there is nothing to settle.');
  }
  if (!payee || payee.netCents <= 0) {
    throw new HttpError(400, 'That person is not currently owed money in this group.');
  }
}

// Starts a "settle up" payment: the current user (payer) pays payeeId the
// given amount, either for real via YouPI-PG (in-app UPI) or recorded as a
// cash/manual payment ("mark as paid", Splitwise's own fallback when money
// changed hands outside the app). Either way the settlement row — and the
// group's balance — only ever reflects money that's actually accounted for:
// a YouPI settlement starts PENDING and only becomes SUCCESS once the signed
// webhook confirms it; a cash settlement is SUCCESS immediately because the
// person recording it is asserting the money already moved.
router.post(
  '/',
  asyncHandler(async (req, res) => {
    const { payeeId, amountCents, source, note } = createSettlementSchema.parse(req.body);
    if (payeeId === req.user.id) throw new HttpError(400, 'Cannot settle up with yourself');

    const payee = db
      .prepare(
        `SELECT u.id, u.name, u.email FROM users u
         JOIN group_members gm ON gm.user_id = u.id
         WHERE u.id = ? AND gm.group_id = ?`
      )
      .get(payeeId, req.groupId);
    if (!payee) throw new HttpError(400, 'payeeId must be a member of this group');

    requireActualDebt(req.groupId, req.user.id, payeeId);
    const groupCurrency = db.prepare('SELECT currency FROM groups WHERE id = ?').get(req.groupId).currency;

    if (source === 'cash') {
      const { lastInsertRowid: settlementId } = db
        .prepare(
          `INSERT INTO settlements
             (group_id, payer_id, payee_id, amount_cents, currency, source, status, method, note, completed_at)
           VALUES (?, ?, ?, ?, ?, 'cash', 'SUCCESS', 'CASH', ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))`
        )
        .run(req.groupId, req.user.id, payeeId, amountCents, groupCurrency, note || null);

      logActivity(req.groupId, req.user.id, 'settlement_succeeded', {
        settlementId,
        payeeId,
        amountCents,
        currency: groupCurrency,
        source: 'cash',
      });

      return res.status(201).json({
        settlement: {
          id: settlementId,
          amount: centsToRupeeString(amountCents),
          currency: groupCurrency,
          status: 'SUCCESS',
          source: 'cash',
        },
      });
    }

    const orderId = `GRP${req.groupId}-STL-${req.user.id}-${payeeId}-${Date.now()}`;

    const { lastInsertRowid: settlementId } = db
      .prepare(
        `INSERT INTO settlements (group_id, payer_id, payee_id, amount_cents, currency, source, youpi_order_id)
         VALUES (?, ?, ?, ?, ?, 'youpi', ?)`
      )
      .run(req.groupId, req.user.id, payeeId, amountCents, groupCurrency, orderId);

    const returnUrl = `${process.env.CLIENT_ORIGIN}/groups/${req.groupId}?settlement=${settlementId}`;

    let payment;
    try {
      payment = await createYoupiPayment({
        orderId,
        amount: centsToRupeeString(amountCents),
        currency: groupCurrency,
        customer: { name: req.user.name, email: req.user.email },
        description: `Settle up with ${payee.name}`,
        returnUrl,
        metadata: { settlementId, groupId: req.groupId, payerId: req.user.id, payeeId },
      });
    } catch (err) {
      // Don't leave an orphaned PENDING row if YouPI-PG never created a session.
      db.prepare('DELETE FROM settlements WHERE id = ?').run(settlementId);
      throw err;
    }

    db.prepare(
      `UPDATE settlements SET youpi_payment_id = ?, youpi_checkout_url = ? WHERE id = ?`
    ).run(payment.paymentId, payment.checkoutUrl, settlementId);

    logActivity(req.groupId, req.user.id, 'settlement_started', {
      settlementId,
      payeeId,
      amountCents,
      currency: groupCurrency,
      source: 'youpi',
    });

    res.status(201).json({
      settlement: {
        id: settlementId,
        orderId,
        amount: centsToRupeeString(amountCents),
        currency: groupCurrency,
        checkoutUrl: payment.checkoutUrl,
        status: payment.status,
        source: 'youpi',
      },
      payer: { name: req.user.name, email: req.user.email },
      // Public, not secret — safe to hand to the browser so it can load the
      // in-app checkout script (data-youpi-key) for this same order.
      youpi: {
        checkoutHost: process.env.YOUPI_CHECKOUT_HOST,
        merchantKey: process.env.YOUPI_MERCHANT_ID,
      },
    });
  })
);

export default router;
