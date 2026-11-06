# Surveil-Me-Not — Beta Plan (MVP → pre-production)

Status: **PLAN ONLY — awaiting approval. No code written.**
Date: 2026-11-05. Branch: `mvp`. Canonical paths: local `/Users/fdp/surveil-me-not`, VPS
`/home/deploy/surveil-me-not`, GitHub `fdpitney2000/Surveil-Me-Not` (URL case is cosmetic; the
directory is lowercase). See `docs/paths.md`.

This plan covers the transition from the token/credit-ledger MVP to the API-key-level
beta model you described, plus the seven items in your brief: real users, overall project
recommendations, the Loops launch newsletter, self-service data download/delete, live
OpenRouter keys, the single-file landing page / white-label path, and hidden-by-default
bring-your-own-key settings.

Read this with `PLAN.md` (Round 1 architecture), `PLAN-ROUND2.md` (round 2 fixes),
`AGENTS.md` (module boundaries), and `docs/surveil.md` (runbook).

> **Architecture decision (2026-11-05):** Beta uses **one OpenRouter key per customer**.
> `limit` = net; `expires_at` = exact next anniversary; the three tier endpoints share the key
> and enforce privacy through server-injected `addParams`. No per-user workspace, no workspace
> budget, no per-tier guardrails, no per-tier reporting. See `docs/architecture-review.md`.

---

## 0. TL;DR — the ten decisions I recommend

**Decision record (revised 2026-11-05):** D1 one OpenRouter key per customer
(`limit` = net, `expires_at` = exact next anniversary; tiers are request-level policies on three
endpoints; no per-user workspace or workspace budget); D2 20% of gross; D3 key expiry = exact
Stripe period end; D4 key usage is the source of truth; D5 keep test Stripe, real users via
Loops; D6 self-service export/delete; D7 single brand tokenized, tenant-ready; D8 BYOK
subscription-only; D9 Loops transactional re-permission with double opt-in; D10 14-day backup
retention and immediate Stripe cancellation on account deletion; D11 free tier uses one shared
free key; D12 top-ups under $2,000 for active subscribers.
1. **One OpenRouter key per customer.** `limit` = net; `expires_at` = exact next anniversary.
   The three tier endpoints share the key and enforce privacy through server-side `addParams`.
   No per-user workspace, no workspace budget, no per-tier key guardrails, no per-tier
   reporting.
2. **The key limit is the pool.** A key can hold only one guardrail, so the tier policy is
   request-level. The key never leaves the server; users never see it; `verify-tiers` proves
   the routing. A leaked key can bypass tier params; the key limit caps the financial loss and
   the key is rotated on suspicion.
3. **Keep the 20% retention as 20% of gross price** (approved). At full utilization that is
   exactly a 20% gross margin; the key caps are **$35.50 / $71.30 / $142.90** for
   $50/$100/$200 (assuming 2.9% + $0.30 Stripe and 5.5% OpenRouter fees). Table in §4.2.
4. **No ledger integrity theater.** The key's `usage`, `limit`, and `expires_at` are the source
   of truth. Store a period-start usage snapshot for display and margin reporting; drop the
   2-minute reconciler in favor of a 15–60 minute refresh plus the on-demand refresh button.
   The key limit and expiry do the enforcement.
5. **Real users, test Stripe.** Keep the test-mode Stripe account for beta. Add real email
   verification and password reset through Loops transactional email, plus abuse controls,
   legal pages, backups, and observability. "Test users" means seeded/dummy accounts — those
   get cleaned up; real signups do not.
6. **Self-service data export and delete.** Add `GET /api/surveil/export` (streamed JSON/zip)
   and `DELETE /api/surveil/data` (delete all chat history, keep the account). Full account
   deletion keeps its existing cascade and gains Stripe cancellation + Loops contact deletion.
   14-day backup retention and immediate Stripe cancellation on full account deletion
   (approved).
7. **Landing page: keep the single file, tokenize the brand.** Add a `brand` JSON block and
   CSS variables, render per host server-side. Do not fork the app per client. Brand the chat
   now via `interface.theme`, `APP_TITLE`, welcome copy, logo/favicon; per-host chat theming
   is a later config resolver.
8. **BYOK hidden by default.** A settings-only "Advanced: use my own OpenRouter key" toggle
   (off), one key for all tiers, encrypted in the existing store, validated against
   OpenRouter before saving. Subscription required; no BYOK discount for beta (approved).
9. **Do not import the 200 contacts as subscribed.** Send one Loops transactional
   re-permission blast with a double opt-in link (approved). Use a founder-style sender and a
   monitored reply-to, send in small warm-up batches, and do not follow up with non-openers.
   Only opt-ins join the "Launch updates" list. Use a separate marketing subdomain
   (`news.surveil-me-not.com`) from transactional (`mail.surveil-me-not.com`).
10. **Same OpenRouter organization for staging and production for now** (approved). Keys are
    per customer; use a `staging` key prefix for test traffic. Revisit a separate production
    org at launch if billing/analytics need isolation.

---

## 1. What is actually in the repo today (verified 2026-11-05)

### 1.1 Code inventory

`packages/api/src/surveil/` already contains the full MVP machinery:

| Area | Files |
| --- | --- |
| Config/tiers/key names | `config.ts`, `config.spec.ts` |
| Money/period math | `money.ts`, `period.ts` |
| OpenRouter client/guardrails/usage | `openrouter/client.ts`, `openrouter/guardrails.ts`, `openrouter/usage.ts` |
| Provisioning | `provision.ts` (3 keys per user, one per tier, `limit: 0`, no expiry) |
| Stripe | `stripe/client.ts`, `stripe/checkout.ts`, `stripe/webhook.ts` |
| Credits/reconcile | `credits.ts`, `reconciler.ts`, `expiry.ts` |
| Registration/deletion hooks | `registration.ts`, `deletion.ts` |
| Pricing | `pricing/service.ts` |
| Routes | `routes.ts` (health, webhook, checkout, portal, credits, refresh, pricing) |
| Enforcement tests | `enforcement.spec.ts` |

Client: `client/src/components/Surveil/CreditsWidget.tsx`, `modelAccess.tsx`, and the
`data-provider/Surveil` queries/mutations. Landing: `client/public/home.html` (1,229 lines,
inline CSS/JS, hardcoded brand). Config: `librechat.yaml` (three custom endpoints, no
`interface.theme` yet). Docs: `docs/surveil.md` (188-line runbook).

### 1.2 What already works (from Round 1/2)

- Three custom endpoints choose the privacy tier; `addParams` injects the tier's provider
  block server-side; user payloads are stripped of `provider`/`modelKwargs`.
- Per-user keys are provisioned into LibreChat's encrypted key store; users never see them.
- Stripe Checkout/Portal, webhook signature verification, idempotency by event id, period
  grants, dunning/grace, cancellation, refund/dispute handling.
- Credits widget renders plan/status/remaining/renewal; free models first; paid models
  locked until subscribed.
- Account deletion deletes the user's OpenRouter keys and all LibreChat data.
- `home.html` is served to anonymous visitors at `/`; authenticated visitors get the app.
- The local prod-mode build and the VPS both mount `librechat.yaml`.

### 1.3 Gaps for beta

- No Loops integration in the repo at all (`grep -ri loops` returns nothing). Email is
  nodemailer/Mailgun/SMTP in `api/server/utils/sendEmail.js`.
- No all-data export; only per-conversation export and `DELETE /api/convos/all`.
- No BYOK settings surface; `hideUserProvidedKey: true` and server-provisioned keys only.
- No brand token layer; `home.html` hardcodes "Surveil Me Not", colors, and SVG marks.
- No legal pages (ToS/Privacy/DPA), no abuse controls (CAPTCHA/Turnstile, disposable-email
  blocking), no error tracking/alerting, no documented backup retention.
- The MVP's 3-keys-per-user model is unnecessary for beta. The single-key model gives one
  spend cap and one expiry per customer; per-tier reporting is not needed.
- The key-level tier guardrail is lost by design; the request path is the enforcement. This is
  documented in `docs/architecture-review.md`.
- The 2-minute reconciler is unnecessary once the key's own limit is the enforcement.

---

## 2. The pivot: what "API-key-level" changes

### 2.1 Current model vs beta model

| Concern | MVP (current) | Beta |
| --- | --- | --- |
| Keys per user | 3 (one per tier) | 1 (`surveil:{userId}`) |
| Enforcement | Key guardrail + request params | Server-injected request params (`addParams`) |
| Budget | Ledger + reconciler adjusts each key's limit | Key `limit` = net; OpenRouter enforces |
| Expiry | None | Key `expires_at` = exact next anniversary |
| Usage display | Per-tier snapshots | Total key `usage` / `limit_remaining`; no per-tier reporting |
| Renewal | Period row + limit raise | New key with next expiry and `limit = net`; delete old after grace |
| Cancellation/failure | Disable keys via reconciler | Disable/let expire; grace window |
| Per-tier spend | Yes | No (accepted; not needed) |
| Accounting | Integer micro-USD ledger | Key usage is truth; keep micro-USD for margin records |

### 2.2 The single-key model

One OpenRouter key per customer. The key does two jobs: its `limit` is the spend cap (net
proceeds), and its `expires_at` is the exact next anniversary. The three tier endpoints share
the key; each endpoint's server-side `addParams` injects the tier policy:

- Tier 1 "Max Model Selection": no `provider` block.
- Tier 2 "Commercial Privacy": `provider.data_collection = "deny"`.
- Tier 3 "Enterprise Vault": `provider.zdr = true`, `data_collection = "deny"`.

There is no per-user workspace, no workspace budget, and no per-tier key guardrail. A key can
hold only one guardrail, and one guardrail cannot express three tiers; the request path is the
enforcement. The key never leaves the server; users never see it. The key limit caps financial
loss if it leaks; the app sanitizer strips user-supplied provider params, and `verify-tiers`
proves the routing on every tier.

Trade-offs (accepted 2026-11-05):

- **No key-level tier guardrail.** A leaked key could call OpenRouter without the tier params.
  Mitigations: server-side key, encrypted at rest, rotation on suspicion, usage monitoring, and
  the key limit. If key-level enforcement is ever required, the three-key model is the fallback;
  do not mix the two.
- **No per-tier usage.** One key reports total `usage`; you confirmed per-tier reporting is not
  needed. The credits widget shows total spent/remaining.
- `verify-tiers` plus a per-request privacy receipt (routing metadata, no content) are the
  evidence for the privacy claim.

This removes the workspace-limit, guardrail-scoping, and three-key accounting questions.

### 2.3 Key creation/update contract (from OpenRouter's API docs)

`POST /api/v1/keys` accepts:

```json
{
  "name": "surveil:<userId>",
  "limit": 35.5,
  "limit_reset": null,
  "expires_at": "2026-12-06T00:00:00Z",
  "include_byok_in_limit": false
}
```

- `limit` is USD, minimum 0, exclusive maximum 1,000,000; `null` = no limit. This is the
  customer's spend cap for the period.
- `expires_at` must be ISO 8601 UTC with seconds (`YYYY-MM-DDTHH:MM:SSZ`); minute precision is
  rejected. Set it to the exact next anniversary (Jan 5 → Feb 5).
- `limit_reset` must be `null`; the key `expires_at` owns the period.
- The response returns `hash`, `usage`, `limit`, `limit_remaining`, `expires_at`, `disabled`.
- The plaintext `key` is returned only on create. Store it immediately in the encrypted store.
- No guardrail assignment is required. If you want an org-level backstop, assign one
  spend-only guardrail; it must not carry tier privacy flags.

`PATCH /api/v1/keys/{hash}` accepts `disabled`, `limit`, `limit_reset`, `expires_at`,
`include_byok_in_limit`, `name`. Use it for BYOK toggles, top-ups, or emergency disable;
renewals create a new key with a new `expires_at`.

**Verify live in Phase 0**: create a throwaway key with `expires_at`, read it back, patch the
limit, delete it. The docs are clear, but the plan should not assume the Enterprise account
behaves identically.

## 3. Target architecture

### 3.1 Money and key lifecycle

For a plan price `P`, Stripe fee `S = P × 2.9% + $0.30`, OpenRouter credit-purchase fee
`O = P × 5.5%` (confirm your Enterprise terms), and retention `R = P × 20%`:

```
net_after_fees = P − S − O
key_limit      = net_after_fees − R
```

At full utilization the margin is exactly `R` (20% of gross). At lower utilization the
unused key balance expires and becomes breakage margin. Table in §4.2.

Key lifecycle:

1. `invoice.paid` (`subscription_create` or `subscription_cycle`) → resolve user → compute
   `net` → create a new key `surveil:{userId}` with:
   - `limit = net`,
   - `expires_at = period_end` (the exact next anniversary),
   - `limit_reset = null`.
   Store the new key in the encrypted store under the three endpoint names (the same key serves
   all three tiers). Disable and delete the previous key after a short grace (e.g., 15 minutes)
   so in-flight requests finish. Store `keyHash`, `keyLimitMicroUsd`, `keyExpiresAt`,
   `periodStartUsageMicroUsd`, `periodStart`, `renewsAt`, `plan`, `priceId`,
   `stripeCustomerId`, `stripeSubscriptionId`, `lastEventCreatedAt`.
2. Chat requests go through the tier endpoint, which reads the shared key from the encrypted
   store and injects that endpoint's `addParams`.
3. The credits API reads the key's `usage`, `limit`, `limit_remaining`, and `expires_at`.
   `remaining = limit_remaining`; `spent = usage − periodStartUsage`. No per-tier breakdown.
4. Renewal: create a new key with the next `expires_at` and `limit = net`. The new key starts at
   zero usage, so the period's available amount is exactly `net`; unused balance is discarded
   (no rollover). The old key expires.
5. Cancellation: no new key; the key expires at `renewsAt`. Payment failure: `past_due` → grace
   `SURVEIL_GRACE_DAYS` → disable the key. On recovery, re-enable if unexpired; otherwise create
   a new key with the remaining period's expiry. Refund/dispute: disable immediately and flag
   for review.
6. Account deletion: delete the key and the encrypted store entries.

### 3.2 Why no 2-minute reconciler

The key's `limit` and `expires_at` are enforced by OpenRouter at request time. A periodic job is
only needed to refresh the display. Run it every 15–60 minutes (configurable), plus the existing
`POST /api/surveil/credits/refresh` on demand. There is no per-key limit math and no shared-pool
overspend; the key limit caps the amount and the key expiry caps the time. The only lag is
display freshness.

### 3.3 Privacy enforcement with one key

- Tier 1 "Max Model Selection": no `provider` block.
- Tier 2 "Commercial Privacy": `addParams.provider.data_collection = "deny"`.
- Tier 3 "Enterprise Vault": `addParams.provider.zdr = true`, `data_collection = "deny"`.
- The request sanitizer already strips user-supplied `provider`/`modelKwargs`; keep it.
- Model lists: without a key guardrail, filter server-side in `loadConfigModels`.
  - Tier 3: intersect with the ZDR endpoint list (`GET /api/v1/endpoints/zdr`).
  - Tier 2: intersect with providers whose endpoint metadata says no training/data collection,
    if the models/endpoints API exposes it; otherwise show the full list and surface routing
    errors clearly (the spec's sanctioned fallback).
  - Tier 1: full list.
- Keep `verify-tiers` as the proof: one tiny request per tier, assert the routing metadata.
  Optionally record a per-request privacy receipt (model, provider, ZDR/data-collection flags;
  no content) for the user.

### 3.4 Email architecture

Today `api/server/utils/sendEmail.js` compiles a Handlebars template and sends via Mailgun or
SMTP. For beta, add an email-provider interface in `packages/api`:

```ts
interface EmailProvider {
  send(input: { to: string; subject: string; template: string; payload: Record<string, string>; idempotencyKey?: string }): Promise<void>;
}
```

- `SmtpEmailProvider` wraps the existing nodemailer/Mailgun path (fallback).
- `LoopsEmailProvider` maps `template` → a Loops `transactionalId` (config table) and `payload`
  → `dataVariables`, calls `POST /api/v1/transactional` with an `Idempotency-Key`.
- Auth flows (`AuthService.js`, `email.ts`) call the interface, not `sendEmail` directly.
- Loops templates to create/publish: verify email, password reset, email change, welcome,
  payment failed (optional), subscription canceled (optional). The verification link stays
  LibreChat's existing `/verify?token=...&email=...` URL.
- Fallback: if a template has no Loops ID, use SMTP. If Loops is down, auth still works via
  SMTP (if configured). This avoids a single point of failure for login.
- Loops contact sync: on registration, upsert a contact with `userId`, `email`, `firstName`,
  `source`, `subscribed: false` (no marketing consent). Do not use `addToAudience: true` for
  transactional sends unless the user explicitly opted in. On newsletter opt-in, set
  `subscribed: true` and add to the launch list. On account deletion, delete the contact.

### 3.5 Data model changes (additive where possible)

`ISurveilSubscription` additions:

```ts
keyHash?: string;
keyLimitMicroUsd?: number;
keyExpiresAt?: Date | null;
periodStartUsageMicroUsd?: number;    // key usage at period start
byok?: boolean;
byokKeyHash?: string;                 // hash only; plaintext stays encrypted
```

Keep `snapshotByTier`/`usageByTier` for backward compatibility but stop writing per-tier data.
Do not drop collections in the beta migration; additive fields only. `surveilPeriod` keeps
`invoiceId`, `plan`, `keyLimitMicroUsd`, `periodStart`, `periodEnd`, `kind`; `grantMicroUsd`
becomes the key limit. `surveilEvent` stays for webhook idempotency.

### 3.6 Brand and white-label

- `home.html` becomes a template: keep the single file, add a `BRAND` JSON block at the top
  (`name`, `tagline`, `domain`, `supportEmail`, `primary`, `primaryHover`, `ink`, `bg`,
  `surface`, `logoMark`, `legalLinks`) and replace hardcoded strings with placeholders.
- A server-side renderer (`packages/api/src/surveil/landing.ts` extension) reads the template
  once, substitutes the brand for the request host, and caches per brand. Escape values; never
  interpolate user input.
- `brands/<slug>.json` files hold per-brand values; `librechat.yaml` or env maps hosts to
  slugs. For beta: one brand (`surveil`); the structure is ready for white-label.
- Chat branding now: inline `interface.theme` in `librechat.yaml` matching the landing tokens
  (dark `#0d0d0d`, surface `#212121`, green `#10b981`, text `#ececec`), `APP_TITLE`,
  `customWelcome`, `CUSTOM_FOOTER`, logo/favicon exported from the shield mark. Add a
  `surveil:brand-check` script that asserts the landing tokens and theme tokens match.
- White-label later: per-host `getAppConfig` resolver returns the brand's theme/title/logo.
  Commerce and support stay Surveil; the checkout page discloses "Billing by Surveil Me Not."
  Do not fork the app or the repo per client.

### 3.7 BYOK

- Settings → "Advanced" → toggle "Use my own OpenRouter key" (off by default). The key input is
  hidden until the toggle is on. The toggle is available only to users with an active monthly
  subscription; free users do not see it. This satisfies "should not appear by default" without
  burying the feature.
- One BYOK key for all tiers. Store it encrypted under `surveil:byok`; keep the managed key
  under `surveil:managed` so disabling BYOK restores it. The tier endpoints read the active key
  from the encrypted store under their endpoint name; a small server-side resolver chooses
  managed vs BYOK.
- Validate on save: `GET https://openrouter.ai/api/v1/key` with the user's key; reject inactive,
  no-credit, or malformed keys. Fixed URL (no SSRF). Rate-limit validation. Show last 4 chars.
- Billing: recommend BYOK remains a feature of an active subscription (platform access +
  tier enforcement), but OpenRouter usage is billed to the user's own account. The credits
  widget shows "BYOK active — usage billed by OpenRouter" and stops showing Surveil credits.
  Decide whether to discount the plan; new Stripe prices would be needed.
- Privacy: BYOK requests still pass through our server and still carry the tier's provider
  params. The user's key may have its own guardrails; ours are additive. Disclose that Surveil
  cannot enforce the user's own key's account settings.
- Security: never log the key; encrypted at rest; delete on account deletion; allow rotation;
  do not expose it in the client after save. If the key is invalid at request time, return a
  clear, safe error code and link to settings.

### 3.8 Free-tier shared key

Free users get no per-user OpenRouter keys. One shared key covers all free users, with known
limitations:

- Provision one key `surveil:free`, `limit: 0`, no expiry, assigned to a `surveil:free` guardrail
  with a free-model-only allowlist and no privacy flags.
- The key's `limit: 0` is the primary gate against paid models. Verify in Phase 0 whether a $0
  limit still permits `:free` models; if it does not, use a tiny limit (e.g., $0.01) or rely on
  the free-model allowlist.
- Free users' tier endpoint key entries point at the shared key. For beta, copy the shared key
  into each free user's encrypted store at registration (least invasive); rotate it with a script
  that updates all free users. A server-side resolver is the cleaner alternative if the endpoint
  key path can be hooked without upstream churn.
- On subscription, overwrite the user's endpoint key with their per-user key; on cancellation
  or expiry, revert to the shared free key.
- Rate-limit per user and per IP; the shared key's usage is pooled and cannot be attributed per
  user. Free users see no credits widget (or a "free demo" badge).
- Known limitation: a compromised free user store exposes the shared key, but it can only use
  free models; rotate on abuse. This is accepted for beta.

---

## 4. Billing, margin, and lifecycle

### 4.1 Test Stripe now, live at launch

Keep `SURVEIL_ALLOW_LIVE_STRIPE=false` and the test account for beta. The app already refuses
live keys without the override. At launch: create live prices, live webhook endpoint, live
portal configuration, tax settings, and flip the flag. Do not mix test and live customers in
one database; use a separate production database at launch.

### 4.2 Net-margin table (full utilization and 60% utilization)

Assumptions: Stripe 2.9% + $0.30; OpenRouter 5.5% of gross; retention 20% of gross; no tax, no
refunds/chargebacks. All values USD.

| Plan | Price | Stripe | OpenRouter | Net after fees | Key cap | Margin @100% | Margin @60% |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| $50 | 50.00 | 1.75 | 2.75 | 45.50 | 35.50 | 10.00 (20.0%) | 24.20 (48.4%) |
| $100 | 100.00 | 3.20 | 5.50 | 91.30 | 71.30 | 20.00 (20.0%) | 48.52 (48.5%) |
| $200 | 200.00 | 6.10 | 11.00 | 182.90 | 142.90 | 40.00 (20.0%) | 97.16 (48.6%) |

The "key cap" is the key's `limit` (net) and its `expires_at` is the exact next anniversary.
There is no workspace budget. If "20% retention" means 20% of net after fees instead of gross,
the key caps become $36.40/$73.04/$146.32 and the full-utilization margin drops to ~18.2%. The difference is small
but the formula should be explicit in code and in the checkout copy. **Recommendation: 20% of
gross (approved)** because it is easier to explain and gives a clean 20% margin at full utilization.

If your OpenRouter Enterprise fee is higher than 5.5%, or if Stripe adds tax/currency fees, the
$50 plan is the first to compress. Recommendation: monitor actual fees for the first month and
consider a $75 minimum plan or a 25% retention if the net margin at full utilization falls
below 15%. Do not change the 20% without a new decision.

### 4.3 Upgrade/downgrade/dunning

- Upgrade: create a new key with the current period's expiry and raise the current key's `limit`
  by the prorated net difference. If the upgrade invoice starts a new period, update the
  period-start usage snapshot.
- Downgrade: at next renewal; the current key expires at the period end.
- Payment failure: `past_due`, grace `SURVEIL_GRACE_DAYS` (default 3), then disable the key.
  Send a Loops dunning email with the portal link. On recovery, re-enable if the key has not
  expired; otherwise create a new key with the remaining period's expiry.
- Cancellation: the key is usable until `renewsAt`, then expires. Send a Loops cancellation
  email with the export/delete links.
- Refund/dispute: disable the key immediately, flag for review, do not auto-delete data.
  Manual review.

### 4.4 What to keep from the ledger

Keep integer micro-USD for internal records and margin reporting. Keep `surveilEvent` for
webhook idempotency. Keep `surveilPeriod` for invoice history. Drop per-tier snapshots from the
UI. The key's `usage` and `limit` are the billed truth; our records are for reporting and
support.

### 4.5 Top-ups (approved)

Active subscribers can add funds at any time for any amount under $2,000. A top-up is a
one-time Stripe Checkout payment that raises the current key's `limit`; it is not a new
subscription.

- `POST /api/surveil/topup` (JWT) with `{ amountUsd }`. Require an active subscription and
  managed (non-BYOK) billing. Validate cents: minimum $10, maximum $1,999.99 (configurable).
- Compute net with the same formula (Stripe fee + OpenRouter fee + 20% retention); the
  key's `limit` increases by the net, not the gross. Disclose the net on the checkout page.
- Create a Checkout Session in `payment` mode with `price_data`/`unit_amount`,
  `client_reference_id`, and `metadata: { type: 'topup', userId, amountCents, netCents }`.
  Success/cancel URLs return to the credits widget.
- Webhook: handle `checkout.session.completed` with `metadata.type === 'topup'` and
  `payment_status === 'paid'`; idempotent by session id; raise the key's `limit` by net;
  record a `surveilTopup` row (session id, gross, net, userId, createdAt).
- Expiry: default **expires at the current renewal** (consistent with no rollover), with a clear
  warning. If you want top-ups to carry over, track a separate top-up balance and add it to the
  renewal budget; this is a decision (Q).
- Do not issue a new key; the top-up only raises the current key's `limit`. The key keeps its
  current expiry.
- Top-ups are not available to BYOK users or free users; they can upgrade instead.
- Rate-limit top-ups and rely on Stripe Radar for fraud. Cap per user per day/month if needed.

---

## 5. Real users: authentication, onboarding, abuse, legal

### 5.1 Auth via Loops

- Keep LibreChat's existing token flows. Replace the transport: `sendEmail` becomes the
  provider interface; Loops sends verification, reset, email-change, and welcome messages.
- Loops sending domain: `mail.surveil-me-not.com` (already configured per your note). Verify
  SPF/DKIM/DMARC in the Loops dashboard and send a test to Gmail/Outlook before beta.
- Rate limits: Loops 10 req/s; retry with exponential backoff; use `Idempotency-Key` per
  verification/reset request. LibreChat's existing email rate limiters stay.
- Contact sync: upsert on registration; update email on email change; delete on account
  deletion. Store `userId` as the Loops `userId` so the mapping is stable. Do not auto-subscribe
  to marketing.
- Events: `signup`, `email_verified`, `subscription_started`, `subscription_canceled`,
  `payment_failed` (optional). Use events for lifecycle emails; keep transactional for auth.

### 5.2 Onboarding and real-user guardrails

- Do **not** require email verification before the free demo chat. Require it before paid
  checkout, account recovery, and email change. Free users can chat with `:free` models
  immediately; verification is for account security and paid flows, not for the demo.
- Add Cloudflare Turnstile (or hCaptcha) to registration and login. LibreChat has a registration
  limiter; add a CAPTCHA check at the registration route. Make it configurable and skippable in
  local dev.
- Block disposable email domains (configurable list) and obvious plus-address abuse patterns.
  Keep a small allowlist for testing.
- Per-user and per-IP rate limits on chat, registration, verification resend, and password
  reset. The existing limiters cover some; add chat-level limits for free users.
- Free tier: keep it for acquisition. Free users share one `surveil:free` key (no per-user keys),
  are limited to `:free` models, and get a daily message cap. Turnstile and per-user/IP rate
  limits are the abuse controls; the shared key's `limit: 0` blocks paid models. Document the
  free demo on the landing page.
- Admin panel: restrict to your account; no conversation-content access for support unless the
  user consents. Audit admin actions. This matters for the privacy claim.

### 5.3 Legal and compliance

- Publish brief, high-level drafts of Terms of Service, Privacy Policy, Acceptable Use, and a
  data-processing/addendum page; legal will replace them. The drafts must still name OpenRouter
  and the upstream providers, explain the three tiers, state that Tier 3 requests ZDR, and
  disclose retention (chat data, backups, billing records).
- Cookie/consent: if you add analytics, use a consent banner and prefer privacy-friendly,
  self-hosted or cookieless analytics. Do not load third-party scripts on the landing page
  without consent.
- Age gate: 18+ or the age of majority; add a checkbox at signup.
- Refund policy: state the no-rollover/expiry rule and the refund/dispute behavior. Stripe
  portal can handle cancellations; refunds are manual.
- Data deletion: document backup retention (recommend 14 days) and the export/delete paths.
- If you serve EU/UK users, identify the legal basis (contract for the service, consent for
  marketing), the data controller, and the DPA contact. This is not legal advice; have counsel
  review the final pages.

### 5.4 Operations

- Backups: nightly Mongo dump to encrypted object storage; test a restore before beta. Document
  retention and deletion propagation.
- Observability: structured logs with redaction; health checks for API, Mongo, Redis, OpenRouter,
  Stripe webhook, Loops; alert on webhook failures, key-provisioning failures, management-key
  expiry, and low balance. Sentry is optional but must scrub prompts/completions; prefer
  self-hosted or error-only metadata.
- Runbook: add beta launch checklist to `docs/surveil.md` (DNS, TLS, backups, monitoring,
  Stripe portal/webhook, Loops domains/templates, OpenRouter workspace, key rotation, test
  accounts cleanup).

---

## 6. Self-service data download and delete

### 6.1 Download

`GET /api/surveil/export` (JWT):

- Streams a JSON file (`surveil-export-<userId>-<date>.json`) or a zip if files are included.
- Contents: profile (id, email, name, createdAt, preferences), conversations and messages
  (role, content, createdAt, model, endpoint/tier), files metadata (name, size, createdAt;
  optional file blobs in the zip), memories, presets, agents, shared-link metadata, subscription
  summary (plan, status, period dates; no card data), OpenRouter usage summary. Exclude secrets,
  keys, and other users' data.
- Use a Mongo cursor and stream to avoid loading everything into memory. Cap synchronous
  exports at ~2 GB or 100k messages; if larger, return a 202 with an async job and email a
  signed link via Loops. For beta, synchronous streaming is enough; add the async path if a
  real account hits the cap.
- Add `Content-Disposition: attachment`, `Cache-Control: no-store`, and a short-lived signed
  URL if async. Rate-limit exports (e.g., 1/hour).
- UI: Settings → Data & Privacy → "Download my data" with a progress state and a clear
  explanation of what is included.

### 6.2 Delete all session data (keep account)

`DELETE /api/surveil/data` (JWT, confirmation required):

- Delete conversations, messages, files, memories, presets, agents, shared links, tool calls,
  conversation tags, and other chat-derived records for the user. Keep the user, subscription,
  billing records (anonymized where possible), and encrypted key.
- Reuse the existing deletion cascade from `deleteUserController` minus the user deletion.
  Extract it into a shared service (`packages/data-schemas` or `packages/api`) so account
  deletion and data deletion use the same code path. Invalidate caches and sessions? Keep the
  session; the user stays logged in.
- Confirmation: type "DELETE" or re-enter the password. Add an audit log entry (user id,
  timestamp, action) without content. Rate-limit.
- UI: same settings page, "Delete all chat history" with a warning that it cannot be undone and
  does not cancel the subscription.

### 6.3 Full account deletion

Keep `DELETE /api/user/delete` (password/2FA). Add:

- Cancel the Stripe subscription immediately (approved), with a warning, and disable the keys now.
- Delete the OpenRouter key (already implemented) and the encrypted store entry.
- Delete the Loops contact (new).
- Delete/anonymize billing records per tax/legal requirements; keep invoice ids and amounts
  without personal data where possible.
- 14-day backup retention (approved); deletion propagates when backups rotate out.

### 6.4 "For all time"

Interpret as all historical session data. The export includes all conversations/messages; the
delete removes all of them. If you mean "delete from backups too," that requires a backup purge
process and a longer SLA; recommend documenting the 14-day window instead of promising
instant backup erasure.

---

## 7. Landing page, white-label, and chat branding

### 7.1 Keep the single file

The 1,229-line `home.html` is good for rapid iteration. Keep it as one file, but stop hardcoding
the brand:

- Add a `BRAND` JSON block near the top: name, tagline, domain, support email, colors, logo
  mark, legal links.
- Replace hardcoded strings with `{{brand.name}}`-style placeholders or `data-brand` elements.
- Drive CSS variables from the brand object; keep the existing dark/green palette as the
  `surveil` brand defaults.
- Keep the inline CSS/JS; no build step required for local iteration. The server renders the
  template per host and caches the result. For local dev, a single brand is fine.

### 7.2 White-label path

- `brands/surveil.json` (default), `brands/<client>.json` for clients. A host→brand map in
  `librechat.yaml` or env selects the brand. The landing renderer substitutes values.
- White-label scope: name, logo, colors, domain, support email, legal links. Commerce and
  support remain Surveil; disclose "Billing and support provided by Surveil Me Not" and keep
  the Surveil name in the checkout/portal and legal footer. Do not promise full white-label.
- Chat app: brand the current instance now (theme, title, welcome, footer, logo/favicon). For
  per-client chat theming, add a host-aware `getAppConfig` resolver later; `getAppConfig` is
  already tenant-aware, so this is an extension, not a rewrite. Do not fork the app.
- Stripe Checkout branding is per Stripe account, not per brand. If clients need their own
  checkout look, they need separate Stripe accounts or payment links; for beta, one Surveil
  account and a clear disclosure is enough.

### 7.3 Brand token sync

Add `scripts/surveil/brand-check.mjs` that extracts the landing palette/strings and compares
them to the `interface.theme` tokens and `APP_TITLE`/welcome copy. Fail CI on drift. This keeps
the landing and chat from diverging as you iterate.

---

## 8. Bring-your-own-key (BYOK) settings

### 8.1 UX

- Settings → Advanced → "Use my own OpenRouter API key" toggle. Off by default. When on, show a
  password-style input, "Validate and save", "Remove key", and a note that usage is billed by
  the user's OpenRouter account. The main chat UI never shows the input.
- The toggle and key are per user, not per tier. One BYOK key covers all three tier endpoints.
- If the key is invalid or out of credit, chat returns a safe error and links to settings.

### 8.2 Storage and resolution

- Store the BYOK key encrypted under `surveil:byok`; keep the managed key under
  `surveil:managed`. The tier endpoints read the active key from the encrypted store. A small
  resolver in the Surveil module returns the active key name based on the user's `byok` flag.
  The key limit/budget does not apply to BYOK traffic; the user's own OpenRouter account pays
  for it.
- On enable: validate, store, set `byok: true`, and write the BYOK key to the three endpoint key
  names (or resolve dynamically). On disable: restore the managed key, set `byok: false`.
- On account deletion: delete both.
- Do not expose the key to the client after save; show only the last 4 characters.

### 8.3 Billing and privacy

- Approved: BYOK is available only to active subscribers; the plan price covers the hosted app
  and tier enforcement, while OpenRouter usage is billed to the user. The credits widget shows
  "BYOK active" and no Surveil credits. No discounted BYOK plan for beta; revisit at launch.
- BYOK requests still carry the tier's provider params. Disclose that Surveil cannot enforce the
  user's own OpenRouter account guardrails, only the request-level tier policy.
- Security: fixed validation URL, no user-supplied base URL, encrypted at rest, rate-limited,
  never logged, deleted on account deletion.

---

## 9. Loops launch newsletter (200 personal contacts)

### 9.1 Compliance and list hygiene

The 200 people opted into correspondence with you personally; that is not consent for a product
newsletter. Do not import them as `subscribed: true`. The approved approach is one Loops
transactional re-permission blast with a double opt-in link. Because transactional email bypasses
marketing consent, keep the message strictly a one-time permission request:

- use a founder-style sender name and a monitored `reply-to` (not `noreply@`); the content should
  read as a personal note, not a product promotion;
- remind them how you know each other and why they are receiving it;
- one CTA: click the link to opt in to launch updates;
- include a clear one-click unsubscribe and a physical address if required (CAN-SPAM);
- send once, with no follow-up to non-openers;
- send from the marketing subdomain (`news.surveil-me-not.com`) so a complaint cannot damage the
  auth/transactional domain's reputation, even though the API call is a transactional send;
- warm up in batches: 20–30 contacts first, wait 24–48 h, check bounces/complaints, then the rest.

The link goes to a Loops-hosted double opt-in page/list. Only opt-ins join "Launch updates."
This gives you a clean, consent-based list and protects the sending domain. The risk to watch:
a transactional blast to 200 warm-but-not-consented contacts can produce complaints; keep the
copy personal, the batches small, and stop if the complaint rate rises.

### 9.2 Loops setup (operational, partly manual)

1. Create a mailing list `Launch updates` in the Loops dashboard (or via the Loops API; the CLI
   reference documents listing lists, so use the dashboard/API for creation unless
   `loops agent-context` shows a create command in your installed version).
2. Create contact properties: `consentStatus` (string), `source` (string), `signupDate` (date),
   `planTier` (string), `product` (string).
3. Create a transactional email "Re-permission — launch updates" with variables
   `firstName`, `optInLink`, `unsubscribeLink`. Publish it. Use `loops transactional send` for
   each contact (200 sends, ~20 s at 10 req/s) or the API with `Idempotency-Key`.
4. Create a workflow "Launch updates" triggered by adding to the list: welcome immediately →
   timer 3 days → teaser → timer 7 days → launch → timer 3 days → last call. Or three scheduled
   campaigns if you prefer manual control. Keep 3–4 emails max.
5. Create the launch campaign(s) with a single CTA to the landing page. Use a theme/component
   matching the brand; plain-text-friendly; one link; no image-only emails.
6. Set up the preference center and unsubscribe links; verify they work. Suppress hard bounces
   and complainers automatically (Loops does this).
7. Warm up: send the first batch to the 20–30 most engaged contacts, wait 24–48 h, check
   bounces/complaints, then send the rest. With 200 contacts this is light, but it protects the
   domain.
8. Measure: opt-in rate (target >40% for a warm personal list), bounce <2%, complaint <0.1%,
   open >40%, click >10%. Stop and reassess if complaints spike.

### 9.3 Sending domains

- Transactional/auth: `mail.surveil-me-not.com` (already configured).
- Marketing/newsletter: `news.surveil-me-not.com` (separate subdomain, separate reputation).
  Configure SPF/DKIM/DMARC in Loops; send a test to Gmail/Outlook; check the spam folder.
- From name: "Surveil Me Not" for product news; a founder-style name for the re-permission
  email. Reply-to a monitored inbox. Do not use `noreply@` for the re-permission email.

### 9.4 What the app should do vs what you do manually

- App: sync new signups to Loops as contacts (not subscribed), send auth emails, expose an
  opt-in link/page, delete contacts on account deletion, handle unsubscribe webhooks.
- Manual/dashboard: create the list, properties, templates, workflow/campaigns, import the 200,
  send the re-permission batch, monitor deliverability. The plan can include CLI commands for
  contacts/transactional sends, but the initial list import and campaign setup are dashboard
  steps unless you want a script.

---

## 10. Privacy hygiene audit (what can send user content where)

Default posture: only the selected tier's OpenRouter endpoint receives prompts/completions.
Everything else is off unless explicitly enabled. The table below is the beta audit; each row
names the data path, where it goes, and the recommendation.

| Feature / path | Where data goes | Recommendation |
| --- | --- | --- |
| Chat completions | Selected tier → OpenRouter → upstream provider | **Enabled** (core). Tier 3 forces ZDR; Tier 2 no-training; Tier 1 full catalog. |
| Title generation | Same custom endpoint/OpenRouter (free title model) | **Enabled** but verify it uses the tier endpoint and key; if it bypasses tier params, move it to the same endpoint or disable for Tier 3. |
| Summarization | Same custom endpoint/OpenRouter | **Enabled**; same verification as titles. |
| Web search | External search provider | **Disabled** in `librechat.yaml`; keep provider keys unset. |
| File search / RAG / embeddings | RAG API / vector store | **Disabled**; unset `RAG_API_URL` and embedding keys. |
| Code interpreter / run code | External sandbox | **Disabled**; keep `interface.runCode: false`. |
| MCP tools | External MCP servers | **Disabled**; no `mcpServers` configured. |
| Plugins / actions | Third-party APIs | **Disabled** unless a specific action is reviewed. |
| STT / TTS | OpenAI/Azure/etc. | **Disabled**; unset speech keys. |
| Image generation | OpenAI/Stability/etc. | **Disabled**; unset image keys. |
| OCR | External OCR service | **Disabled**. |
| Langfuse / OTel fan-out | Observability SaaS | **Disabled** unless self-hosted and scrubbed; never send prompts/completions. |
| Analytics (PostHog/GA) | Third-party analytics | **Disabled** or cookieless/self-hosted; no message content. |
| Error tracking (Sentry) | Third-party | Optional; scrub request bodies/prompts; prefer error metadata only. |
| Email (Loops) | Email address, name, verification link | **Enabled** for auth/lifecycle; no chat content. Disclose in privacy policy. |
| Newsletter (Loops) | Email address, name, consent status | **Enabled only with opt-in**; separate marketing subdomain. |
| Stripe | Billing data | **Enabled**; no chat content. |
| File storage (S3/local) | Uploaded files | If enabled, encrypt at rest and document region/retention. Disable file upload for Tier 3 if the storage is third-party. |
| Backups | Mongo dump | Encrypted; 14-day retention; document. |
| Meilisearch | Local search index | Self-hosted; no external egress. If external, disable or disclose. |
| Admin panel | User/conversation metadata | Restrict to owner; no content access without consent; audit. |
| Share links | Public URL | User-initiated; warn that anyone with the link can read the conversation; allow revocation. |
| Export | User download | User-initiated; signed/short-lived; no cache. |
| OpenRouter management API | Key metadata/usage | Server-side only; management key never exposed. |

**Tier 3 rule:** if a feature cannot be proven to stay within the ZDR path, disable it for Tier 3
users (or globally for beta). Document each disabled feature in the privacy page.

---

## 11. File-level change list

### Backend (`packages/api/src/surveil/`)

- `config.ts` — retention pct, BYOK flags, brand config.
- `provision.ts` — create/rotate the single key `surveil:{userId}` with `expires_at` at the next
  anniversary and `limit = net`; store it under the three endpoint names. Also provision the
  shared `surveil:free` key and copy it to free users.
- `stripe/webhook.ts` — compute net; create the new key on `invoice.paid`; renewal, upgrade,
  cancellation, failure, refund/dispute; store key fields.
- `credits.ts` — build response from the key's `usage`, `limit`, `limit_remaining`, `expires_at`;
  period delta; BYOK state.
- `reconciler.ts` — interval 15–60 min; refresh key usage for display; optional.
- `routes.ts` — add `GET /export`, `DELETE /data`, `POST /byok`, `DELETE /byok`, `GET /byok`,
  `POST /topup`.
- `stripe/checkout.ts` — add the one-time top-up Checkout Session (`mode=payment`, ad-hoc
  `price_data`, metadata `type=topup`).
- New: `export.ts` (stream/zip), `delete.ts` (shared purge), `byok.ts` (validate/store/resolve),
  `brand.ts` (brand config/render), `email.ts` (provider interface + Loops/SMTP).
- `landing.ts` — brand-aware renderer and cache.
- `registration.ts` — Loops contact upsert; copy the shared free key for free users; no per-user
  keys until subscription.

### Data layer

- `packages/data-provider/src/surveil.ts` — types for key model, credits, BYOK, brand.
- `packages/data-provider/src/config.ts` — `surveilConfigSchema` fields: `keyMode`,
  `retentionPct`, `byok`, `brand`, `emailProvider`.
- `packages/data-schemas/src/types/surveil.ts` + `schema/surveilSubscription.ts` — additive key
  fields, BYOK fields, period usage.
- New `surveilTopup` schema/model — session id, gross/net micro-USD, userId, createdAt.
- `packages/data-schemas/src/methods/surveil.ts` — queries/updates for the new fields.
- New shared purge function (data-schemas or api) used by account deletion and data deletion.

### Wiring (`api/server`)

- `api/server/routes/surveil.js` — wire new routes; keep CJS thin.
- `api/server/services/AuthService.js` — send via provider interface; Loops contact sync.
- `api/server/controllers/UserController.js` — call shared purge; cancel Stripe; delete Loops
  contact; keep OpenRouter key deletion.
- `api/server/utils/sendEmail.js` — keep as SMTP/Mailgun fallback; do not add logic here.

### Client

- `client/src/components/Surveil/CreditsWidget.tsx` — total key budget/spend, BYOK state, expiry,
  and an "Add funds" top-up action.
- New settings panels: Data & Privacy (export/delete), API Keys (BYOK).
- `client/src/data-provider/Surveil` — queries/mutations for export/delete/BYOK.
- `client/public/home.html` — brand tokens/placeholders; keep single file.
- `brands/surveil.json` — default brand; optional client brands.
- `client/public/assets` — logo/favicon exported from the shield mark.
- `librechat.yaml` — `interface.theme`, `APP_TITLE`, `customWelcome`, `CUSTOM_FOOTER`, tier
  endpoints unchanged; keep privacy toggles off.
- `.env.example` — `LOOPS_API_KEY`, `LOOPS_TRANSACTIONAL_*`, `LOOPS_MARKETING_*`,
  `RETENTION_PCT`, `SURVEIL_BYOK_ENABLED`, `SURVEIL_BRAND_*`, `SURVEIL_FREE_OPENROUTER_KEY`,
  `SURVEIL_TOPUP_MIN_USD`, `SURVEIL_TOPUP_MAX_USD`, backup/retention notes.
- `docs/surveil.md` — beta runbook, margin table, data export/delete, BYOK, Loops.
- New `docs/loops.md`, `docs/privacy.md`, `docs/beta-launch.md`, `docs/paths.md`,
  `docs/architecture-review.md`.

### Tests

- Unit: net/key-limit math (integer micro-USD), key create/rotate, top-up limit increase,
  webhook idempotency and out-of-order, credits response, BYOK validation/resolution, free
  shared-key copy/rotation, export streaming, purge cascade, brand token sync.
- Integration: test-Stripe subscription → webhook → key limit/expiry → chat → credits; top-up
  Checkout → webhook → limit increase; renewal via test clock; cancellation/failure/refund;
  data export/delete; Loops provider with a mock; one live verify-tiers run with a tiny budget.

---

## 12. Phases (one commit each, no push/deploy)

### Phase 0 — Readiness and decisions (no code)
- Confirm the decisions in §0 (especially D1 key model and D2 retention formula).
- Live-check OpenRouter key creation with `expires_at`/`limit`; read back; patch; delete.
  Confirm the key limit/expiry behavior and the Enterprise fee terms.
- Verify Loops: API key, team, sending domain DNS/SPF/DKIM/DMARC, Stripe integration status,
  transactional template capability. Verify the 200-contact import format.
- Verify Stripe test prices, portal config, webhook endpoint; confirm test clock procedure.
- Decide backup retention, legal pages, abuse controls, free-tier shared-key behavior, top-up
  expiry/carryover, and the daily runaway guard.
- Output: a short decision record appended to this plan; no code.

### Phase 1 — Key-level billing and provisioning
- Add retention config; implement the single key with `limit = net` and `expires_at` at the next
  anniversary; the shared `surveil:free` key; update webhook net math; update credits
  API/widget; simplify the reconciler; tests.
- Verify with test Stripe: subscription → key limit/expiry → chat → credits; renewal, cancel,
  failure, refund.
- One commit. No push/deploy.

### Phase 1b — Top-ups
- `POST /api/surveil/topup`; Stripe Checkout `payment` mode; webhook `type=topup`; key limit
  increase; `surveilTopup` record; credits widget "Add funds"; min/max validation;
  idempotency; tests.
- One commit.

### Phase 2 — Real users, Loops auth, onboarding, legal
- Email provider interface; Loops transactional provider; templates; contact sync; verification
  and reset via Loops; SMTP fallback; Turnstile; disposable-email block; rate limits.
- Legal pages and signup consent; privacy page; free-tier policy.
- Tests: provider mapping, auth flows, contact sync, fallback.
- One commit.

### Phase 3 — Data export/delete
- Shared purge service; export service (stream/zip); routes; settings UI; audit log; Loops and
  OpenRouter cleanup on full deletion; Stripe cancellation.
- Tests: export contents, purge cascade, permissions, rate limits.
- One commit.

### Phase 4 — Landing tokenization and chat branding
- Brand JSON + placeholders; server renderer; default brand; chat theme/title/welcome/footer/
  logo/favicon; brand-check script; tests.
- Verify landing and chat match in light/dark; no regression to anonymous/auth routing.
- One commit.

### Phase 5 — BYOK settings
- Toggle, validation, encrypted storage/resolution, restore managed key on disable, billing
  behavior, UI, tests. One commit.

### Phase 6 — Newsletter launch
- Loops list/properties/templates/workflow; app opt-in page and contact sync; import the 200 as
  pending; send re-permission; warm-up; metrics. Mostly operational; code for the opt-in page
  and contact sync. One commit for code; manual steps documented.

### Phase 7 — Hardening and beta launch
- Privacy audit implementation (disable/verify each row); abuse controls; observability;
  backups; runbook; E2E; test-account cleanup; beta checklist. One commit.

---

## 13. Risks and mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Key leak bypasses tier params | Privacy claim weakens | Key server-side only, encrypted at rest, never client-side; rotate on suspicion; monitor usage; the key limit caps loss; document the threat model. |
| No per-tier reporting | Accepted; total-only usage | You confirmed per-tier reporting is not needed. If that changes, log endpoint/tier per request (no content) or return to three keys. |
| Key expiry vs renewal race | Chat fails at period boundary | `expires_at = period_end` exactly; create the new key on `invoice.paid`; monitor webhook lag; optional 1 h grace if a race appears. |
| Key limit needs current usage for top-ups/renewals | Wrong limit if usage is stale | Read the key's `usage` immediately before raising the limit; store the snapshot; alert on mismatch. |
| Key expiry vs renewal race | Chat fails at period boundary | `expires_at = period_end` exactly; create the new key on `invoice.paid`; monitor webhook lag; optional 1 h grace if a race appears. |
| Margin compression | $50 plan below target | Monitor actual Stripe/OpenRouter fees; raise minimum plan or retention with approval; table in §4.2. |
| Loops outage | Verification/reset emails fail | SMTP fallback; queue/retry; health check; do not block login for existing users. |
| Loops transactional misuse | Deliverability/spam complaints | Auth/lifecycle only; marketing separate subdomain; double opt-in; unsubscribe. |
| Newsletter re-permission perceived as spam | Complaints, domain damage | Personal sender, one email, clear opt-in, no follow-up to non-openers; small warm-up batches. |
| Large data export | Timeout/memory | Stream; cap; async job with signed link; rate-limit. |
| Backup deletion | "Delete all time" not literal | Document 14-day backup retention; offer manual purge process; set expectations. |
| White-label chat theming | yaml theme is global | Brand landing now; per-host resolver later; do not fork. |
| BYOK stolen key | Abuse / charges to user | Validate, encrypt, never log, rate-limit, allow revoke; monitor failures. |
| Top-up expiry surprises users | Support load, refund requests | Clear copy at checkout and in the widget; optional carryover balance if you choose it. |
| Shared free key abuse | Free-model abuse, pooled usage | Per-user/IP rate limits, Turnstile, free-only guardrail, rotate on abuse. |
| Shared free key rotation | Free users hold stale copies | Rotation script updates every free user's encrypted store; monitor failures. |
| Test vs live Stripe | Launch surprises | Separate DB at launch; live checklist; keep test mode for beta. |
| Admin content access | Privacy claim undermined | Restrict admin, no content access without consent, audit. |

---

## 14. Decisions and remaining questions

### Answered 2026-11-05

1. **Key model:** one OpenRouter key per customer; `limit` = net; `expires_at` = exact next
   anniversary. The three tier endpoints share the key and enforce privacy through server-side
   `addParams`. No per-user workspace, no workspace budget, no per-tier guardrails.
2. **Per-tier reporting:** not needed. Total key usage/remaining is sufficient.
3. **Tier policies:** the same three privacy tiers for all users; a new key is issued at signup,
   renewal, upgrade, and cancellation in near real time.
4. **Billing anchor:** signup date (Jan 5 → Feb 5); the key's `expires_at` is set to that exact
   date.
5. **Free tier:** no per-user keys; one shared `surveil:free` key for all free users. Known
   limitations accepted (pooled usage, shared-key exposure, rate limits).
6. **Loops:** free tier; no transactional templates created yet. Stripe integration status still
   to verify.
7. **Test data:** wipe seeded users/conversations after a dry-run list.
8. **BYOK:** active monthly subscription required.
9. **Email verification:** not required before the free demo chat.
10. **Brand:** single Surveil brand for beta; tenant-ready architecture.
11. **Legal:** brief, high-level drafts; legal will replace them.
12. **OpenRouter org:** same organization for staging and production for now.
13. **Paths:** lowercase everywhere; `docs/paths.md` added.
14. **403 mapping and top-ups:** map the key-exhausted error to a friendly message; add top-ups
    for any amount under $2,000. Plan in §4.5.

### Remaining questions

1. ★ **Top-up expiry and terms:** expire at the current renewal (consistent with no rollover;
   recommended) or carry over until used? Same 20% retention/fees? Minimum $10, maximum
   $1,999.99?
2. ★ **Loops Stripe integration:** is the test Stripe account connected in Loops, or should Phase
   0 verify/configure it?
3. ★ **Free shared key implementation:** approve copying the shared key into each free user's
   encrypted store for beta (least invasive) with a rotation script, or invest in a server-side
   resolver?
4. ★ **Top-up availability:** only when the remaining balance is low, or anytime for active
   subscribers?
5. **Legal drafts:** entity name, jurisdiction, and contact address for the brief templates.
6. **Phase order:** billing/email/data first, then branding/newsletter? Current plan order.
7. **Branch:** create `staging` from `mvp` now? (Recommended.)
8. **Tenant descriptor:** Mongo, YAML, or env? (Recommend Mongo with a YAML bootstrap for the
   default tenant.)
9. **Gateway timing:** extract `surveil-gateway` at v1, or only when wholesale starts?

---

## 15. Appendix — current vs target request/response shapes

### Credits response (target)

```json
{
  "plan": "50",
  "status": "active",
  "periodStart": "2026-11-05T00:00:00.000Z",
  "renewsAt": "2026-12-05T00:00:00.000Z",
  "keyLimitUSD": 35.5,
  "spentUSD": 12.34,
  "remainingUSD": 23.16,
  "keyExpiresAt": "2026-12-06T00:00:00.000Z",
  "byok": false,
  "lowBalance": false,
  "lastSyncedAt": "2026-11-05T12:00:00.000Z"
}
```

No `perTier` field: usage is total-only. Keep `grantUSD` as an alias for `keyLimitUSD` during
the transition if the client still reads it.

### Webhook net calculation (target)

```ts
const stripeFee = price * STRIPE_FEE_PCT / 100 + STRIPE_FEE_FIXED;
const openRouterFee = price * OPENROUTER_FEE_PCT / 100;
const retention = price * RETENTION_PCT / 100;
const keyLimit = price - stripeFee - openRouterFee - retention;
```

All money as integer micro-USD internally; convert to USD only at the OpenRouter API boundary
and in the client response. Clamp `keyLimit` at 0; if it is 0 or negative, do not create a key
and flag the subscription for review.

### OpenRouter key create (target)

```json
{
  "name": "surveil:<userId>",
  "limit": 35.5,
  "limit_reset": null,
  "expires_at": "2026-12-06T00:00:00Z",
  "include_byok_in_limit": false
}
```

The key's `limit` is the spend cap; `expires_at` is the period boundary. On renewal, create a new
key with the next expiry and `limit = net`; delete the old key after a grace. Top-ups `PATCH` the
current key's `limit` to `current usage + netTopup`.

---

*End of plan. Approve or amend the starred decisions in §14; I will not write code until you
approve.*
