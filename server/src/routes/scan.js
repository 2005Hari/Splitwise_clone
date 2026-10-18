import { Router } from 'express';
import multer from 'multer';
import db from '../db/index.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { HttpError } from '../middleware/errorHandler.js';
import { requireAuth, requireGroupMember } from '../middleware/auth.js';
import { extractReceiptData } from '../services/receiptAI.js';
import { convertCents } from '../services/fxRates.js';

const router = Router({ mergeParams: true });
router.use(requireAuth, requireGroupMember);

const SCANNABLE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    if (!SCANNABLE_TYPES.includes(file.mimetype)) {
      cb(new HttpError(400, `Unsupported image type: ${file.mimetype}`));
      return;
    }
    cb(null, true);
  },
});

// Reads a photo of a receipt and returns suggested expense fields — it does
// NOT create the expense. The caller (the Add Expense form) pre-fills from
// this, the user picks who to split with (or just accepts the default of
// everyone), and submits through the normal POST /expenses endpoint like
// any other expense.
router.post(
  '/',
  upload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) throw new HttpError(400, 'No image uploaded (field name must be "file")');

    let extracted;
    try {
      extracted = await extractReceiptData(req.file.buffer, req.file.mimetype);
    } catch (err) {
      throw new HttpError(err.notConfigured ? 503 : 502, err.message);
    }

    const groupCurrency = db.prepare('SELECT currency FROM groups WHERE id = ?').get(req.groupId).currency;
    let amountCents = Math.round(Number(extracted.amount) * 100) || 0;
    let convertedFrom = null;

    if (extracted.readable && amountCents > 0 && extracted.currency && extracted.currency !== groupCurrency) {
      const converted = await convertCents(amountCents, extracted.currency, groupCurrency);
      if (converted !== null) {
        convertedFrom = { amountCents, currency: extracted.currency };
        amountCents = converted;
      }
    }

    res.json({
      readable: extracted.readable,
      description: extracted.merchantName || '',
      amountCents: extracted.readable ? amountCents : 0,
      category: extracted.category,
      currency: groupCurrency,
      convertedFrom,
      notes: extracted.notes || '',
    });
  })
);

export default router;
