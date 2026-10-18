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

## Third pass: receipts, recurring, notifications, live FX

All four of the remaining flagged gaps were closeable **without signing up
for any external account** (the one rule this project holds hardest to), so
they're now built:

- [x] **Receipt/photo uploads** (`services/fileStorage.js`,
      `routes/receipts.js`) — local disk (`server/data/uploads`), never a
      public static folder: every read goes through an authenticated,
      group-membership-checked route. JPEG/PNG/WebP/GIF/PDF, 10MB cap.
- [x] **Recurring expenses** (`services/scheduler.js`, `routes/recurring.js`)
      — an in-process `setInterval`, not an external cron service (the
      server already has to be running for the app to work at all, so this
      adds no new deployment dependency). Properly catches up every missed
      occurrence if the server was down, capped at 366 to avoid a runaway
      backfill. A template whose split no longer resolves (a participant
      left the group) pauses itself with a logged reason instead of
      retry-looping forever or failing silently.
- [x] **Web Push notifications** (`services/webPush.js`, `routes/push.js`,
      `client/public/sw.js`) — standard browser Push API with a
      self-generated VAPID keypair (auto-created on first boot if not in
      `.env`, cached to `data/vapid-keys.json`). No push-notification SaaS
      account anywhere in this path. Fires on a new expense, a comment, and
      a confirmed settlement — never to the person who triggered it.
- [x] **Live currency conversion** (`services/fxRates.js`) — Frankfurter
      (ECB reference rates), free and keyless. Used only for one optional
      "combined, approximate" total on the dashboard when a user's balances
      span more than one currency; the exact per-currency figures remain
      authoritative everywhere, and a failed rate lookup is reported as
      "unconverted," never silently folded into the total.
- [x] **Email** (`services/email.js`) — plain SMTP, same pattern as
      everything else: the user supplies their own provider's credentials in
      `.env`; unset, it logs and no-ops rather than erroring. Verified the
      actual send path (not just the no-op) against a disposable Ethereal
      test account — but **not** against a real SMTP server from inside this
      build environment: its outbound network only tunnels HTTP/HTTPS, so a
      raw SMTP connection on port 587 timed out here. That's a constraint of
      *this* sandbox, not the code; a normal server environment reaches SMTP
      directly.

`routes/expenses.js`'s create logic moved into `services/expenseCreation.js`
so the recurring-expense scheduler replays a charge through the *exact same*
validated split engine a one-off expense uses — no parallel, potentially
drifting implementation.

## Fourth pass: AI receipt scanning

A feature Splitwise itself doesn't have, same build philosophy as YouPI-PG:
official API, user's own credentials, graceful no-op when unconfigured.

- [x] **`services/receiptAI.js` / `routes/scan.js`** — a receipt photo goes
      to NVIDIA NIM's vision API (`meta/llama-3.2-90b-vision-instruct` by
      default, OpenAI-compatible chat completions with `response_format:
      json_object`), comes back as `{merchant, amount, currency,
      category, readable}`, and pre-fills the Add Expense form client-side
      (`components/ScanReceipt.jsx`). It never creates the expense itself —
      the person still picks who splits it and reviews before saving, same
      as a manually-typed expense. Needs the user's own `NVIDIA_API_KEY`;
      unset, the route returns a clear 503 rather than failing in a way
      that looks like a bug. (Originally built against the Claude API —
      switched to NVIDIA mid-build once a real NVIDIA key became available
      to test with and the user chose to use it as the shipped provider
      instead of Anthropic; see the verification note below for how that
      choice was reached.)
- [x] A currency mismatch between the receipt and the group converts at a
      live rate (reusing `services/fxRates.js`) and says so; an unreadable
      photo opens the form anyway instead of inventing numbers.
- [x] Once the resulting expense is saved, the same photo is attached to it
      as a receipt automatically, reusing `routes/receipts.js` rather than
      a second upload path.
- [x] Client-side image downscaling (`ScanReceipt.jsx`, canvas-based, max
      1600px / JPEG 0.85) before upload — keeps the API call's cost and
      latency bounded regardless of the original phone-camera photo size,
      and that same downscaled image is what ends up as the receipt
      attachment, so there's no separate larger upload after.
- [x] **Verified against a live NVIDIA API call**, not just the no-op path:
      a synthetic test receipt (generated with PIL, not a real document)
      run through the actual shipped route (`POST
      /expenses/scan`) correctly returned the merchant name and exact total
      the image showed; a cross-currency scan converted correctly at the
      live rate; a blank image correctly came back `readable: false` with
      an explanatory note instead of invented numbers. Then driven through
      the real browser UI end to end: the form visibly pre-filled from the
      live response, the expense saved, and the photo auto-attached as a
      receipt (confirmed by its thumbnail actually rendering). No
      Anthropic key was ever available in this build environment to test
      the original implementation the same way — that's the reason it was
      actually switched, not left as an unverified alternative.
- Found and fixed while building this: a global `input { display: block }`
  rule was overriding the browser's default `[hidden] { display: none }`,
  so every hidden file input in the app — including the receipts feature's
  existing "Attach a receipt" button from the previous round — rendered its
  native file-picker UI instead of staying hidden. One global CSS rule
  fixed both.

## What's intentionally not built
Native mobile apps — meaningfully more scope than a backend/frontend change
(a separate React Native or Capacitor project, device testing, app store
accounts the user would hold, not this project). Flagged here rather than
silently missing from `features.csv` so `/replica-diff` has an honest
baseline to score against.
