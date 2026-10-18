// AI receipt scanning via NVIDIA NIM (https://build.nvidia.com), an
// OpenAI-compatible vision API. A receipt photo goes in, a structured
// {merchant, amount, currency, category, readable} guess comes out, so the
// "Add an expense" form can be pre-filled instead of typed by hand.
//
// Same pattern as every other integration in this app: the user supplies
// their own NVIDIA_API_KEY in .env (build.nvidia.com); unset, the feature
// returns a clear "not configured" error instead of a broken call. Plain
// `fetch` against the documented REST contract, same house style as
// services/youpiClient.js, rather than pulling in an SDK for one endpoint.
import { CATEGORY_IDS } from './categories.js';

const NVIDIA_API_URL = 'https://integrate.api.nvidia.com/v1/chat/completions';

const PROMPT = `This is a photo of a restaurant, hotel, or shop receipt. Reply with ONLY a JSON object (no markdown fences, no other text) with exactly these keys:
- "merchantName": string — the business name on the receipt, "" if unreadable
- "amount": string — the final total actually paid (not a subtotal, not one line item), as a plain decimal number e.g. "1249.50", "" if unreadable
- "currency": string — best-guess ISO 4217 currency code (INR, USD, EUR, ...) from symbols like "Rs" or "$" or context
- "category": one of ${JSON.stringify(CATEGORY_IDS)} — best matching expense category
- "readable": boolean — false if this is not a legible receipt (too blurry, cropped, or not a receipt at all)
- "notes": string — one short sentence on anything worth flagging, "" if nothing notable`;

// Some vision models wrap JSON in ```json fences despite instructions not
// to, even with response_format: json_object requested — strip before parsing.
function extractJson(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return JSON.parse((fenced ? fenced[1] : text).trim());
}

/**
 * @param {Buffer} imageBuffer
 * @param {string} mimeType - image/jpeg, image/png, image/webp or image/gif
 * @returns {Promise<{readable: boolean, merchantName: string, amount: string, currency: string, category: string, notes: string}>}
 */
export async function extractReceiptData(imageBuffer, mimeType) {
  const apiKey = process.env.NVIDIA_API_KEY;
  if (!apiKey) {
    const err = new Error(
      'AI receipt scanning needs your own NVIDIA API key: set NVIDIA_API_KEY in server/.env ' +
        '(get one at https://build.nvidia.com).'
    );
    err.notConfigured = true;
    throw err;
  }

  const model = process.env.NVIDIA_VISION_MODEL || 'meta/llama-3.2-90b-vision-instruct';
  const dataUrl = `data:${mimeType};base64,${imageBuffer.toString('base64')}`;

  const response = await fetch(NVIDIA_API_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      max_tokens: 512,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: PROMPT },
            { type: 'image_url', image_url: { url: dataUrl } },
          ],
        },
      ],
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`NVIDIA API error (${response.status}): ${body.slice(0, 300)}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error('NVIDIA API returned an empty response.');

  let parsed;
  try {
    parsed = extractJson(content);
  } catch {
    throw new Error('Could not read structured data from that receipt — try a clearer photo.');
  }

  return {
    readable: parsed.readable !== false,
    merchantName: typeof parsed.merchantName === 'string' ? parsed.merchantName : '',
    amount: typeof parsed.amount === 'string' ? parsed.amount : '',
    currency: typeof parsed.currency === 'string' && parsed.currency ? parsed.currency.toUpperCase() : 'INR',
    category: CATEGORY_IDS.includes(parsed.category) ? parsed.category : 'general',
    notes: typeof parsed.notes === 'string' ? parsed.notes : '',
  };
}
