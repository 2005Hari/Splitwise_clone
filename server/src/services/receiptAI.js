// AI receipt scanning: a photo of a restaurant/hotel bill goes in, a
// structured { merchant, amount, currency, category } guess comes out, so
// the "Add an expense" form can be pre-filled instead of typed by hand.
// Uses the Claude API directly (not a third-party OCR service) with its
// structured-outputs feature, which validates the model's response against
// a schema server-side rather than hoping a prompted "return JSON" holds up.
//
// Same pattern as every other integration in this app: the user supplies
// their own ANTHROPIC_API_KEY in .env (console.anthropic.com); unset, the
// feature returns a clear "not configured" error instead of a broken call.
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import { CATEGORY_IDS } from './categories.js';

let client;
function getClient() {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  if (!client) client = new Anthropic();
  return client;
}

const ReceiptSchema = z.object({
  readable: z
    .boolean()
    .describe('false if this is not a legible receipt/bill — too blurry, cropped, or not a receipt at all'),
  merchantName: z.string().describe('The business/establishment name printed on the receipt, or "" if unreadable'),
  amount: z
    .string()
    .describe(
      'The final total actually paid (not a subtotal, not a single line item), as a plain decimal string e.g. "1249.50". "0" if unreadable.'
    ),
  currency: z
    .string()
    .describe('Best-guess ISO 4217 currency code (INR, USD, EUR, GBP, ...) from symbols, "Rs", "$", or context'),
  category: z.enum(CATEGORY_IDS).describe('Best matching expense category for this receipt'),
  notes: z
    .string()
    .describe('One short sentence on anything worth flagging (why this category, or what made it hard to read). "" if nothing notable.'),
});

/**
 * @param {Buffer} imageBuffer
 * @param {string} mimeType - image/jpeg, image/png, image/webp or image/gif
 * @returns {Promise<{readable: boolean, merchantName: string, amount: string, currency: string, category: string, notes: string}>}
 */
export async function extractReceiptData(imageBuffer, mimeType) {
  const anthropic = getClient();
  if (!anthropic) {
    const err = new Error(
      'AI receipt scanning needs your own Anthropic API key: set ANTHROPIC_API_KEY in server/.env ' +
        '(get one at https://console.anthropic.com/settings/keys).'
    );
    err.notConfigured = true;
    throw err;
  }

  const model = process.env.ANTHROPIC_MODEL || 'claude-opus-5-5';

  const response = await anthropic.messages.parse({
    model,
    max_tokens: 1024,
    output_config: {
      format: zodOutputFormat(ReceiptSchema),
      effort: 'low', // a bounded extraction task, not open-ended reasoning
    },
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mimeType, data: imageBuffer.toString('base64') } },
          {
            type: 'text',
            text:
              'This is a photo of a restaurant, hotel, or shop receipt. Extract the merchant name, the ' +
              'final total amount actually paid, its currency, and the expense category it best matches.',
          },
        ],
      },
    ],
  });

  if (response.stop_reason === 'refusal') {
    throw new Error('The AI declined to process this image.');
  }
  if (!response.parsed_output) {
    throw new Error('Could not read structured data from that receipt — try a clearer photo.');
  }
  return response.parsed_output;
}
