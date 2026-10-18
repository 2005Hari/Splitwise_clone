import { Router } from 'express';
import db from '../db/index.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { requireAuth } from '../middleware/auth.js';
import { listCounterparties, friendBalanceByCurrency } from '../services/splitEngine.js';
import { convertBuckets } from '../services/fxRates.js';
import { SUPPORTED_CURRENCIES } from '../services/currencies.js';

const router = Router();
router.use(requireAuth);

// "You are owed / you owe" across absolutely everything — every group and
// every direct friend — bucketed by currency so a USD trip and an INR
// dinner are never silently summed into one misleading number. Pass
// ?in=<currency> to also get one approximate combined total, converted at
// live rates (see services/fxRates.js) — the per-currency buckets stay the
// exact, authoritative figures either way.
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const counterparties = listCounterparties(req.user.id);
    const byCurrency = new Map();
    for (const f of counterparties) {
      for (const { currency, netCents } of friendBalanceByCurrency(req.user.id, f.id)) {
        byCurrency.set(currency, (byCurrency.get(currency) || 0) + netCents);
      }
    }

    const groupCount = db
      .prepare(
        `SELECT COUNT(*) AS n FROM group_members gm JOIN groups g ON g.id = gm.group_id
         WHERE gm.user_id = ? AND g.kind = 'group'`
      )
      .get(req.user.id).n;

    const balances = [...byCurrency.entries()]
      .filter(([, cents]) => cents !== 0)
      .map(([currency, netCents]) => ({ currency, netCents }));

    let converted = null;
    const targetCurrency = typeof req.query.in === 'string' ? req.query.in.toUpperCase() : null;
    if (targetCurrency && SUPPORTED_CURRENCIES.includes(targetCurrency) && balances.length > 0) {
      converted = await convertBuckets(balances, targetCurrency);
    }

    res.json({ balances, converted, groupCount, friendCount: counterparties.length });
  })
);

export default router;
