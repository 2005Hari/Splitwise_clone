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

## Second pass: expenses, settlements, friends

- [x] Expense edit/delete — any group member may edit or delete (matches
      Splitwise's own permission model); delete is soft (`deleted_at`), so
      comments and activity history survive and nothing is destroyed.
- [x] Split by percentage and by shares/ratio, in addition to equal/exact —
      server-validated (percentages must sum to 100 within 0.01; shares just
      need to be positive), using the largest-remainder method so split
      cents always sum exactly to the expense total.
- [x] Cash ("mark as paid") settlements — immediately `SUCCESS`, no gateway
      involved, for when money changed hands outside the app; same
      debt-direction validation as a UPI settlement (see the architecture
      note on group vs. friend balance for exactly what's validated and why).
- [x] Comments, a per-group activity feed, member leave/remove (blocked
      while the person has a nonzero balance, so a debt never loses its
      owner), cross-group Friends balances, a dashboard overall summary.
- [x] Found and fixed during testing (not left for the user to discover):
      the settlement-direction and friend-balance math had the sign of the
      "already paid" settlement terms inverted, which could both wrongly
      block a legitimate settlement and wrongly allow an already-settled
      debtor to keep paying. Caught by driving the real app end to end, not
      by code review alone — see the architecture note on group vs. friend
      balance for the corrected formula.

## What's intentionally not built
Push/email notifications, receipt/photo attachments, recurring expenses,
native mobile apps, live currency conversion between groups (each group has
one currency; cross-group aggregates bucket by currency instead of
converting). Flagged here rather than silently missing from `features.csv`
so `/replica-diff` has an honest baseline to score against.
