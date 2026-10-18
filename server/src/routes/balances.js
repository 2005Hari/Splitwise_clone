import { Router } from 'express';
import { requireAuth, requireGroupMember } from '../middleware/auth.js';
import { computeGroupBalances, simplifyDebts } from '../services/splitEngine.js';
import { asyncHandler } from '../utils/asyncHandler.js';

const router = Router({ mergeParams: true });
router.use(requireAuth, requireGroupMember);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const balances = computeGroupBalances(req.groupId);
    const transfers = simplifyDebts(balances);
    res.json({ balances, transfers });
  })
);

export default router;
