// HMAC-SHA256 verification for YouPI-PG's authoritative server-to-server
// webhook, exactly as specified in docs/DEVELOPER_INTEGRATION.md / AGENTS.md:
// - the signature is computed over the RAW, unparsed request body (never the
//   re-serialized JSON object: re-stringifying can reorder keys and break it)
// - compared in constant time to resist timing attacks
// - header format is `X-Gateway-Signature: sha256=<64 hex chars>`
import crypto from 'node:crypto';

export function verifyYoupiSignature(rawBody, signatureHeader, secret) {
  if (!signatureHeader || !secret) return false;
  const expected =
    'sha256=' + crypto.createHmac('sha256', secret).update(rawBody).digest('hex');

  const a = Buffer.from(signatureHeader);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
