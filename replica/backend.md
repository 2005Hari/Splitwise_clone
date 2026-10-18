# Backend checklist — written following `replica-backend`

## Auth
- [x] Email + password sign up, bcrypt-hashed.
- [x] Sessions as http-only, `sameSite=lax` cookies (secure in production).
- [x] Sign out clears the cookie.
- [ ] Password reset / email verification — not built; add before any real launch.
- [ ] OAuth (Google) — not built.

## Database
- [x] Schema in `server/src/db/schema.sql`, applied on boot (idempotent `CREATE TABLE IF NOT EXISTS`).
- [x] Access rule: every group-scoped route runs `requireGroupMember`, which
      401s/403s unless `req.user` is in `group_members` for that `:groupId` —
      this is the one authorization check, applied in the data layer, not trusted
      from the client.
- [x] Seed script with fake data (`npm run db:seed`), no real people.
- [ ] Backups — SQLite file lives on one disk; add a cron/off-site copy before trusting it with real money data.

## Payments — YouPI-PG, not Stripe
This app integrates **[YouPI-PG](https://github.com/youpi-pg/YouPI-PG)**, a
self-hosted UPI/COD gateway, instead of Stripe, because that's what the user
asked for. Same rules apply:

- [x] **Official, public API only**, with the user's own merchant id and
      webhook secret from their own running instance. Nothing proxied,
      nothing scraped.
- [x] **The user runs the gateway and creates the keys.** Claude did not
      stand up a YouPI-PG instance, create a merchant account, or invent a
      webhook secret. `server/.env.example` lists `YOUPI_API_URL`,
      `YOUPI_MERCHANT_ID`, `YOUPI_WEBHOOK_SECRET`, `YOUPI_CHECKOUT_HOST` with
      no values — see "Wiring up payments" in the README for how to fill
      them in from your own `merchant-admin` dashboard.
- [x] **Webhook signature verified** (`server/src/services/webhookVerify.js`):
      HMAC-SHA256 over the raw body, constant-time compare, exactly as
      `docs/DEVELOPER_INTEGRATION.md` specifies.
- [x] **Idempotent webhook handling**: `webhook_events.delivery_id` is a
      primary key, checked before any settlement is touched.
- [x] **Settlement status lives in our database**, written only by the
      webhook handler. The client's `Youpi.pay()` success callback is used
      for optimistic UI copy only — never to flip a balance.
- [x] **In-app checkout**: the official `youpi.js` widget + `Youpi.pay()`
      programmatic call (loaded in `client/src/hooks/useYoupiScript.js`,
      driven from `client/src/components/SettleUpButton.jsx`), not a redirect
      away from the app.

## Security checklist
- [x] Secrets only in `.env` (`server/.gitignore`'d), nothing in the client
      bundle except the YouPI merchant id and checkout host, which YouPI-PG's
      own docs say are publishable, not secret.
- [x] Input validated server-side with `zod` on every mutating route.
- [x] Authorization checked on every group route (`requireGroupMember`).
- [x] Webhook verifies signature before touching the database.
- [x] No user data in URLs or logs.
- [ ] Rate limiting on auth routes — not added yet; do this before any public deploy.
- [ ] `npm audit` run on real dependency installs — run it once `npm install` has actually been done (this environment couldn't reach the npm registry to install and audit).

## What's intentionally not built
Expense editing/deletion, group removal, push/email notifications, receipts/
attachments, multi-currency. Flagged here rather than silently missing from
`features.csv` so `/replica-diff` has an honest baseline to score against.
