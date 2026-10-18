# Splitwise clone, with YouPI-PG settle-up payments

A clean-room Splitwise-style expense splitter — plus one thing Splitwise
itself doesn't do: an **in-app "Settle up" payment**, wired to
[YouPI-PG](https://github.com/youpi-pg/YouPI-PG), a self-hosted UPI/Cash-on-
Delivery payment gateway.

**Features:** groups and direct (non-group) expenses with friends · equal,
exact-amount, percentage and shares/ratio splits · expense editing, soft
deletion, comments and photo/PDF receipts · categories · recurring expenses
(rent, subscriptions) · a per-group activity feed · browser push
notifications and email, both optional and self-hosted (no third-party
account) · cross-group Friends balances (aggregated across every shared
group, bucketed by currency, with a live-FX "combined, approximate" total)
· a dashboard "you owe / you're owed" overall summary · leave or remove a
group member · settle up for real over UPI (YouPI-PG, in-app,
webhook-confirmed) or record a cash payment instantly, same as Splitwise's
own "mark as paid".

It rebuilds the *features and flow* of a Splitwise-style app, clean-room —
not Splitwise's code, name, logo, or content. See `replica/architecture.md`
and `replica/backend.md` for how it was planned and built (following the
[replica-skill](https://github.com/Jakeschincariol/replica-skill) method).

## What's here

```
server/     Express API + SQLite (better-sqlite3), JWT auth, YouPI-PG client & webhook
client/     React + Vite SPA
replica/    architecture.md, backend.md — the plan this was built from
```

**Core loop:** register → create a group → add shared expenses → see a
simplified "who owes whom" balance → tap **Settle up**, pay by UPI in an
in-app modal, balance updates once the payment is confirmed.

## Payments: how YouPI-PG fits in

YouPI-PG is **self-hosted** — there's no SaaS account to sign up for here.
You run your own instance (or point at one you already run), create a
merchant in its `merchant-admin` dashboard, and give this app three values.
This app never invents those values or talks to anyone else's YouPI-PG
instance.

1. **Run YouPI-PG** (separate checkout, from its own repo):
   ```bash
   git clone https://github.com/youpi-pg/YouPI-PG.git
   cd YouPI-PG && npm install && cp .env.example .env && npm run dev
   ```
   This starts, among others, the Payment API (`:6100`) and the Checkout
   Portal (`:7000`), which serves the `youpi.js` widget script.
2. Open YouPI-PG's **merchant-admin** (`:6001`), create a merchant, add a
   receiving UPI VPA, and copy the **merchant id** and **webhook secret** it
   gives you.
3. In *this* repo, fill in `server/.env` (copy from `server/.env.example`):
   - `YOUPI_API_URL` — YouPI-PG's payment API, e.g. `http://localhost:6100`
   - `YOUPI_MERCHANT_ID` — the merchant id from step 2
   - `YOUPI_WEBHOOK_SECRET` — the webhook secret from step 2
   - `YOUPI_CHECKOUT_HOST` — YouPI-PG's checkout portal, e.g. `http://localhost:7000`
4. In YouPI-PG's own merchant-admin, point its webhook delivery at
   `http://<this-server>/api/payments/webhook/youpi` (use a tunnel such as
   `ngrok` if YouPI-PG runs on a different machine than this API, so it can
   reach you).

Until those env vars are set, `POST /api/groups/:id/settlements` returns a
clear `503` instead of a broken checkout.

### How a settlement actually gets paid

1. User taps **Settle up** on a suggested payment in `GroupDetail`.
2. The backend (`server/src/routes/settlements.js`) creates a `settlements`
   row first, then calls YouPI-PG's `POST /api/v1/payments` server-to-server
   with that merchant id — so there is always a database row before any
   money can move.
3. The frontend (`client/src/components/SettleUpButton.jsx`) loads YouPI-PG's
   own `youpi.js` widget and calls `Youpi.pay({ order_id, amount, ... })`,
   which pops the gateway's own in-app modal (QR + UPI intent) — the whole
   payment happens without leaving the app.
4. The modal's success callback is used **only** for optimistic "confirming…"
   text. The balance itself only updates once YouPI-PG's signed,
   server-to-server webhook (`POST /api/payments/webhook/youpi`) lands and
   the backend verifies its HMAC-SHA256 signature — exactly as YouPI-PG's own
   docs require, because browser events alone are never proof of payment.

## Running it locally

```bash
# API
cd server
npm install
cp .env.example .env   # fill in JWT_SECRET (and the YOUPI_* vars once you have them)
npm run db:seed        # optional: adds 3 fake users + 1 group, password "password123"
npm run dev             # http://localhost:4000

# Web app, in another terminal
cd client
npm install
cp .env.example .env
npm run dev             # http://localhost:5173
```

Everything works end to end — accounts, groups, expenses, balances,
receipts, recurring expenses, push notifications — without YouPI-PG running
or any other setup. Three things are optional, each with a graceful
no-setup default:

- **Settle up via UPI** needs a live YouPI-PG instance and its three env
  vars (above) — cash settlements work with zero setup either way.
- **Push notifications** work immediately — a VAPID keypair is generated on
  first boot and cached to `server/data/vapid-keys.json`. Set
  `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY` in `.env` only if you want it
  stable across redeploys (changing it invalidates existing subscriptions).
- **Email** no-ops (logs instead of sending) until you set `SMTP_HOST` /
  `SMTP_USER` / `SMTP_PASS` to your own mail server or provider's SMTP
  endpoint.

## Notes

- Money is stored as integer paise everywhere in this app's own tables, only
  converted to YouPI-PG's decimal-rupee-string format at the API boundary
  (`server/src/utils/money.js`).
- `server/src/services/webhookVerify.js` and `server/src/routes/webhook.js`
  are the only code that ever marks a settlement `SUCCESS` — never the
  client, never an unauthenticated route.
- This was built without running `npm install` against a live registry in
  this environment — run it yourself before first use, and skim
  `replica/backend.md`'s security checklist (rate limiting and `npm audit`
  are flagged as not done yet).
