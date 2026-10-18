import { Router } from 'express';
import db from '../db/index.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { requireAuth } from '../middleware/auth.js';
import { listCounterparties, friendBalanceByCurrency } from '../services/splitEngine.js';

const router = Router();
router.use(requireAuth);

// "You are owed / you owe" across absolutely everything — every group and
// every direct friend — bucketed by currency so a USD trip and an INR
// dinner are never silently summed into one misleading number.
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

    res.json({
      balances: [...byCurrency.entries()]
        .filter(([, cents]) => cents !== 0)
        .map(([currency, netCents]) => ({ currency, netCents })),
      groupCount,
      friendCount: counterparties.length,
    });
  })
);

export default router;
