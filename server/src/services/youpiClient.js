// Thin REST client for a self-hosted YouPI-PG instance
// (https://github.com/youpi-pg/YouPI-PG), following its public contract in
// docs/MERCHANT_INTEGRATION.md and openapi.yaml. We talk to it server-to-server
// so a settlement always has a database row before any money can move, and so
// YOUPI_WEBHOOK_SECRET / the merchant id never reach the browser.
import { HttpError } from '../middleware/errorHandler.js';

function requireConfig() {
  const { YOUPI_API_URL, YOUPI_MERCHANT_ID } = process.env;
  if (!YOUPI_API_URL || !YOUPI_MERCHANT_ID) {
    throw new HttpError(
      503,
      'Payments are not configured yet: set YOUPI_API_URL and YOUPI_MERCHANT_ID to your ' +
        'own running YouPI-PG instance in server/.env (see server/.env.example).'
    );
  }
  return { YOUPI_API_URL, YOUPI_MERCHANT_ID };
}

/**
 * Creates a payment session on YouPI-PG for one settlement.
 * @param {object} params
 * @param {string} params.orderId - stable id we control, e.g. `STL-<settlementId>`
 * @param {string} params.amount - decimal rupee string, e.g. "499.00"
 * @param {string} params.currency
 * @param {{name:string,email:string,phoneNumber?:string}} [params.customer]
 * @param {string} [params.description]
 * @param {string} [params.returnUrl]
 * @param {object} [params.metadata]
 */
export async function createYoupiPayment({
  orderId,
  amount,
  currency = 'INR',
  customer,
  description,
  returnUrl,
  metadata,
}) {
  const { YOUPI_API_URL, YOUPI_MERCHANT_ID } = requireConfig();

  const response = await fetch(`${YOUPI_API_URL}/api/v1/payments`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Merchant-Id': YOUPI_MERCHANT_ID,
      // Re-sending for the same settlement must not open a second payment session.
      'Idempotency-Key': orderId,
    },
    body: JSON.stringify({ orderId, amount, currency, customer, description, returnUrl, metadata }),
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new HttpError(
      response.status === 409 ? 409 : 502,
      body.error || body.message || `YouPI-PG rejected the payment request (${response.status})`
    );
  }
  return body; // { paymentId, orderId, amount, amountPaise, currency, status, checkoutUrl }
}

export async function getYoupiPaymentStatus(paymentId) {
  const { YOUPI_API_URL } = requireConfig();
  const response = await fetch(`${YOUPI_API_URL}/api/v1/payments/${paymentId}`);
  if (!response.ok) return null;
  return response.json();
}

export async function cancelYoupiPayment(paymentId) {
  const { YOUPI_API_URL } = requireConfig();
  const response = await fetch(`${YOUPI_API_URL}/api/v1/checkout/${paymentId}/cancel`, {
    method: 'POST',
  });
  return response.ok;
}
