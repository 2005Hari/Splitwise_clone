// Local-disk storage for expense receipts — no S3/Cloudflare R2 account
// needed. Files live under server/data/uploads, named by a random key with
// no relation to the original filename, and are only ever reachable through
// an authenticated, group-membership-checked route (routes/receipts.js),
// never a public static folder.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const UPLOAD_DIR = path.resolve(process.cwd(), process.env.UPLOAD_DIR || './data/uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

export const ALLOWED_RECEIPT_TYPES = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'application/pdf': '.pdf',
};

export const MAX_RECEIPT_BYTES = 10 * 1024 * 1024; // 10 MB

export function storageKeyFor(contentType) {
  const ext = ALLOWED_RECEIPT_TYPES[contentType] || '';
  return `${crypto.randomUUID()}${ext}`;
}

export function pathForKey(storageKey) {
  // storageKey is always our own generated UUID(.ext) — never user input —
  // so there is no path traversal surface here, but resolve+verify anyway.
  const resolved = path.resolve(UPLOAD_DIR, storageKey);
  if (!resolved.startsWith(UPLOAD_DIR + path.sep)) {
    throw new Error('Invalid storage key');
  }
  return resolved;
}

export function deleteFile(storageKey) {
  const filePath = pathForKey(storageKey);
  fs.rm(filePath, { force: true }, () => {});
}

export { UPLOAD_DIR };
