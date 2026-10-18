import { Router } from 'express';
import express from 'express';
import db from '../db/index.js';
import { verifyYoupiSignature } from '../services/webhookVerify.js';

const router = Router();

// Mounted with express.raw() so req.body is the exact bytes YouPI-PG signed —
// parsing to JSON first (even to re-stringify) would change whitespace/key
// order and break HMAC verification. See docs/DEVELOPER_INTEGRATION.md "Browser
// events are strictly for UI feedback; only this webhook may mark an order paid."
router.post('/youpi', express.raw({ type: 'application/json' }), (req, res) => {
  const signature = req.headers['x-gateway-signature'] || '';
  const deliveryId = req.headers['x-gateway-delivery-id'] || '';
  const secret = process.env.YOUPI_WEBHOOK_SECRET;

  if (!verifyYoupiSignature(req.body, signature, secret)) {
    return res.status(401).json({ error: 'Invalid webhook signature' });
  }

  let payload;
  try {
    payload = JSON.parse(req.body.toString('utf8'));
  } catch {
    return res.status(400).json({ error: 'Malformed JSON body' });
  }

  // Idempotency: YouPI-PG retries on non-2xx, and deliveries can duplicate.
  if (deliveryId) {
    const already = db.prepare('SELECT 1 FROM webhook_events WHERE delivery_id = ?').get(deliveryId);
    if (already) return res.status(200).json({ received: true, duplicate: true });
    db.prepare('INSERT INTO webhook_events (delivery_id, event, order_id) VALUES (?, ?, ?)').run(
      deliveryId,
      payload.event || 'UNKNOWN',
      payload.orderId || null
    );
  }

  const settlement = db
    .prepare('SELECT id, status FROM settlements WHERE youpi_order_id = ?')
    .get(payload.orderId);

  if (settlement && ['SUCCESS', 'FAILED', 'EXPIRED', 'CANCELLED'].includes(payload.event)) {
    // Once a terminal SUCCESS is recorded, nothing can downgrade it.
    if (settlement.status !== 'SUCCESS') {
      db.prepare(
        `UPDATE settlements
         SET status = ?, utr = ?, method = ?, youpi_payment_id = COALESCE(?, youpi_payment_id),
             completed_at = CASE WHEN ? = 'SUCCESS' THEN strftime('%Y-%m-%dT%H:%M:%fZ','now') ELSE completed_at END
         WHERE id = ?`
      ).run(payload.event, payload.utr || null, payload.method || null, payload.paymentId || null, payload.event, settlement.id);
    }
  }

  res.status(200).json({ received: true });
});

export default router;
