import { Router } from 'express';
import multer from 'multer';
import fs from 'node:fs';
import db from '../db/index.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { HttpError } from '../middleware/errorHandler.js';
import { requireAuth, requireGroupMember } from '../middleware/auth.js';
import { logActivity } from '../services/activity.js';
import {
  ALLOWED_RECEIPT_TYPES,
  MAX_RECEIPT_BYTES,
  storageKeyFor,
  pathForKey,
  deleteFile,
} from '../services/fileStorage.js';

const router = Router({ mergeParams: true });
router.use(requireAuth, requireGroupMember);

function requireExpense(expenseId, groupId) {
  const expense = db
    .prepare('SELECT id, description FROM expenses WHERE id = ? AND group_id = ? AND deleted_at IS NULL')
    .get(expenseId, groupId);
  if (!expense) throw new HttpError(404, 'Expense not found');
  return expense;
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_RECEIPT_BYTES, files: 1 },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_RECEIPT_TYPES[file.mimetype]) {
      cb(new HttpError(400, `Unsupported file type: ${file.mimetype}. Use JPEG, PNG, WebP, GIF or PDF.`));
      return;
    }
    cb(null, true);
  },
});

router.get(
  '/',
  asyncHandler(async (req, res) => {
    requireExpense(req.params.expenseId, req.groupId);
    const receipts = db
      .prepare(
        `SELECT r.id, r.original_name, r.content_type, r.size_bytes, r.created_at, r.uploaded_by, u.name AS uploaded_by_name
         FROM expense_receipts r JOIN users u ON u.id = r.uploaded_by
         WHERE r.expense_id = ? ORDER BY r.created_at ASC`
      )
      .all(req.params.expenseId);
    res.json({ receipts });
  })
);

router.post(
  '/',
  upload.single('file'),
  asyncHandler(async (req, res) => {
    const expense = requireExpense(req.params.expenseId, req.groupId);
    if (!req.file) throw new HttpError(400, 'No file uploaded (field name must be "file")');

    const storageKey = storageKeyFor(req.file.mimetype);
    fs.writeFileSync(pathForKey(storageKey), req.file.buffer);

    const { lastInsertRowid } = db
      .prepare(
        `INSERT INTO expense_receipts (expense_id, uploaded_by, storage_key, original_name, content_type, size_bytes)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(expense.id, req.user.id, storageKey, req.file.originalname.slice(0, 200), req.file.mimetype, req.file.size);

    logActivity(req.groupId, req.user.id, 'expense_updated', {
      expenseId: expense.id,
      description: expense.description,
      note: 'attached a receipt',
    });

    res.status(201).json({
      receipt: {
        id: lastInsertRowid,
        original_name: req.file.originalname,
        content_type: req.file.mimetype,
        size_bytes: req.file.size,
      },
    });
  })
);

router.get(
  '/:receiptId/file',
  asyncHandler(async (req, res) => {
    requireExpense(req.params.expenseId, req.groupId);
    const receipt = db
      .prepare('SELECT * FROM expense_receipts WHERE id = ? AND expense_id = ?')
      .get(req.params.receiptId, req.params.expenseId);
    if (!receipt) throw new HttpError(404, 'Receipt not found');

    res.setHeader('Content-Type', receipt.content_type);
    res.setHeader('Content-Disposition', `inline; filename="${receipt.original_name.replace(/"/g, '')}"`);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    fs.createReadStream(pathForKey(receipt.storage_key)).pipe(res);
  })
);

router.delete(
  '/:receiptId',
  asyncHandler(async (req, res) => {
    requireExpense(req.params.expenseId, req.groupId);
    const receipt = db
      .prepare('SELECT * FROM expense_receipts WHERE id = ? AND expense_id = ?')
      .get(req.params.receiptId, req.params.expenseId);
    if (!receipt) throw new HttpError(404, 'Receipt not found');
    if (receipt.uploaded_by !== req.user.id && req.membership.role !== 'owner') {
      throw new HttpError(403, 'Only the uploader or the group owner can remove this receipt');
    }

    db.prepare('DELETE FROM expense_receipts WHERE id = ?').run(receipt.id);
    deleteFile(receipt.storage_key);
    res.status(204).end();
  })
);

export default router;
