import { Router } from 'express';
import { z } from 'zod';
import db from '../db/index.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { HttpError } from '../middleware/errorHandler.js';
import { requireAuth, requireGroupMember } from '../middleware/auth.js';
import { createYoupiPayment } from '../services/youpiClient.js';
import { centsToRupeeString } from '../utils/money.js';

const router = Router({ mergeParams: true });
router.use(requireAuth, requireGroupMember);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const rows = db
      .prepare(
        `SELECT s.id, s.amount_cents, s.currency, s.status, s.utr, s.method,
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
        `SELECT id, amount_cents, currency, status, utr, method, created_at, completed_at,
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
});

// Starts an in-app "settle up" payment: the current user (payer) pays payeeId
// the given amount via YouPI-PG. We create the settlement row first so the
// webhook always has something to match against, then open a YouPI-PG
// payment session server-to-server and hand the client what it needs to
// render the in-app checkout (see docs/DEVELOPER_INTEGRATION.md "Youpi.pay").
router.post(
  '/',
  asyncHandler(async (req, res) => {
    const { payeeId, amountCents } = createSettlementSchema.parse(req.body);
    if (payeeId === req.user.id) throw new HttpError(400, 'Cannot settle up with yourself');

    const payee = db
      .prepare(
        `SELECT u.id, u.name, u.email FROM users u
         JOIN group_members gm ON gm.user_id = u.id
         WHERE u.id = ? AND gm.group_id = ?`
      )
      .get(payeeId, req.groupId);
    if (!payee) throw new HttpError(400, 'payeeId must be a member of this group');

    const orderId = `GRP${req.groupId}-STL-${req.user.id}-${payeeId}-${Date.now()}`;

    const { lastInsertRowid: settlementId } = db
      .prepare(
        `INSERT INTO settlements (group_id, payer_id, payee_id, amount_cents, youpi_order_id)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(req.groupId, req.user.id, payeeId, amountCents, orderId);

    const returnUrl = `${process.env.CLIENT_ORIGIN}/groups/${req.groupId}?settlement=${settlementId}`;

    let payment;
    try {
      payment = await createYoupiPayment({
        orderId,
        amount: centsToRupeeString(amountCents),
        currency: 'INR',
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

    res.status(201).json({
      settlement: {
        id: settlementId,
        orderId,
        amount: centsToRupeeString(amountCents),
        currency: 'INR',
        checkoutUrl: payment.checkoutUrl,
        status: payment.status,
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
