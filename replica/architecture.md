# Architecture — Splitwise clone with YouPI-PG settle-up

Written following `replica-architect`. This clone rebuilds Splitwise's core
loop (groups, shared expenses, balances) plus one feature Splitwise itself
doesn't have: an in-app payment to actually settle a debt, via a self-hosted
UPI gateway, [YouPI-PG](https://github.com/youpi-pg/YouPI-PG).

## Stack

| layer | choice | why |
| --- | --- | --- |
| API | Node.js + Express | small surface, no framework ceremony for ~10 routes |
| database | SQLite (`better-sqlite3`) | zero setup, matches YouPI-PG's own zero-dependency local story; swap for Postgres by rewriting `server/src/db` if this needs to scale past one box |
| auth | bcrypt + JWT in an http-only cookie | no third-party auth needed for an MVP clone |
| web app | React + Vite | small SPA, fast dev loop |
| payments | self-hosted **YouPI-PG** | the one the user asked for: UPI + COD, no aggregator fees, merchant runs their own instance |

One database. No microservices. The clone needs Splitwise's features, not its
infrastructure.

## Schema

See `server/src/db/schema.sql` (applied automatically on boot). Tables:
`users`, `groups`, `group_members`, `expenses`, `expense_shares`,
`settlements`, `webhook_events`.

Money is integer cents/paise everywhere in this app's own tables. YouPI-PG's
API takes a decimal rupee string, so the conversion happens at exactly one
seam: `server/src/utils/money.js`.

`settlements` is the join between this app's ledger and YouPI-PG's payment
state machine: one row per "pay user X ₹Y" attempt, carrying YouPI-PG's
`orderId`/`paymentId`/`checkoutUrl` and mirroring its own status enum
(`PENDING → SUCCESS | FAILED | EXPIRED | CANCELLED`). `webhook_events` exists
purely for idempotency, since YouPI-PG retries webhook delivery on non-2xx.

## API

| method path | does | input | output |
| --- | --- | --- | --- |
| POST /api/auth/register, /login, /logout, GET /me | account + session | — | user |
| GET/POST /api/groups | list/create groups | name | group |
| GET /api/groups/:id | group + members | — | group, members |
| POST /api/groups/:id/members | invite by email | email | member |
| GET/POST /api/groups/:id/expenses | list/add expense | description, amount, payer, split | expense |
| GET /api/groups/:id/balances | net balance per member + simplified debts | — | balances, transfers |
| GET/POST /api/groups/:id/settlements | list / start a settle-up payment | payeeId, amountCents | settlement + YouPI checkout info |
| GET /api/groups/:id/settlements/:sid | poll one settlement's status | — | settlement |
| POST /api/payments/webhook/youpi | **YouPI-PG → us**, authoritative payment outcome | raw signed body | 200 |

Webhook in: `/api/payments/webhook/youpi`, mounted before the JSON body
parser so the HMAC is verified over the exact bytes YouPI-PG signed.

Only YouPI-PG's own public, documented REST contract is used
(`POST /api/v1/payments`, `GET /api/v1/payments/:id`, the signed webhook) —
never a private endpoint, and always with keys the user generates themselves
in their own YouPI-PG merchant-admin.

## The parts that bite

- **Webhooks arrive twice.** `webhook_events.delivery_id` is a primary key;
  a duplicate `X-Gateway-Delivery-Id` short-circuits before anything else runs.
- **Browser payment events are not proof of payment.** YouPI-PG says this
  explicitly, and the client (`SettleUpButton.jsx`) only uses its `handler`
  callback for optimistic UI text — the balance only updates once the backend
  flips a settlement to `SUCCESS`, which only the signed webhook can do.
- **Race: two people settling the same debt at once.** Each settlement is its
  own row with its own `orderId`; a second attempt opens a second payment
  session rather than corrupting the first. Minor double-payment risk (both
  succeed) is a UX problem to surface in a future iteration, not a ledger bug.
- **Money precision.** Integer paise/cents in the database and every
  calculation; only converted to YouPI-PG's decimal string at the API
  boundary.
- **Self-hosted dependency.** YouPI-PG isn't a hosted SaaS with a public API
  key you sign up for — the user runs their own instance. `server/.env.example`
  documents exactly which three values (API URL, merchant id, webhook secret)
  come from that instance, and payment routes fail with a clear 503 rather
  than a stack trace if they're unset.

## Build order

1. ✅ Vertical slice: register → create group → add expense → see balance.
2. ✅ Must-haves: multi-member groups, equal + custom splits, debt
   simplification, invite by email.
3. ✅ Payments: YouPI-PG settle-up, in-app checkout, signed webhook.
4. Should-haves (not built yet): expense editing/deletion, per-group currency,
   activity feed, email notifications, OAuth login.

Next step per the skill: `/replica-test` (write a test plan and Playwright
specs against the flows above) before extending further.
