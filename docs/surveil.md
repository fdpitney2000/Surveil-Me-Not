# Surveil-Me-Not — local runbook

Privacy-tiered hosted LibreChat. Users subscribe monthly, receive a USD credit balance, and
choose a privacy tier by choosing a model endpoint. Spend is metered from OpenRouter's
reported per-key usage. Each customer has one OpenRouter key; tier privacy is enforced by the
server-injected `provider` block on that tier's custom endpoint. See `PLAN-BETA.md` for the
beta design and `AGENTS.md` for contribution rules.

## 1. Prerequisites

- Node 22+ and npm (repo pins npm 11).
- MongoDB (local or Docker).
- Stripe CLI logged into **test** mode (`stripe --version`).
- An OpenRouter **organization** Management API key.

## 2. Configure `.env`

Copy the Surveil block from `.env.example` and fill in (never commit values):

```
SURVEIL_ENABLED=true
OPENROUTER_MANAGEMENT_KEY=...
SURVEIL_OPENROUTER_MGMT_KEY_EXPIRES_AT=2026-01-01T00:00:00Z   # optional, for rotation warnings
STRIPE_SECRET_KEY=sk_test_...
SURVEIL_STRIPE_WEBHOOK_SOURCE=cli
STRIPE_PRICE_50_ID=price_1UCmtfR35hoGDQ2ENiQn79YJ
STRIPE_PRICE_100_ID=price_1UCmtfR35hoGDQ2EwXZj3QCg
STRIPE_PRICE_200_ID=price_1UCmtfR35hoGDQ2E5eCt2WRO
OPENROUTER_FEE_PCT=5.5
RETENTION_PCT=20
```

For the ten-tester beta, cap keys created by Stripe **test-mode** invoices without changing
the production plan math:

```env
SURVEIL_TEST_KEY_LIMIT_USD=1
```

This applies only when the Stripe event has `livemode: false`; live-mode invoices still get
the plan's normal net proceeds. The subscription's credit grant is also set to the test cap,
so the UI does not claim the full $50/$100/$200 balance. Remove the variable for production.
For a `$1` test cap, also set `SURVEIL_LOW_BALANCE_USD=0.10`; otherwise the default `$5`
low-balance threshold makes a test account look depleted immediately.

Verify presence without printing values:

```
npm run surveil:check-env
```

The app refuses to start with a live Stripe key unless `SURVEIL_ALLOW_LIVE_STRIPE=true`.

## 2a. Email verification via Loops

If `EMAIL_HOST`/`EMAIL_SERVICE` are empty and no Mailgun/Loops credentials are set,
`checkEmailConfig()` is false and registration auto-verifies the account. That is the demo
behavior you are seeing.

To require real email verification:

1. In Loops, create and publish two transactional emails with these data variables:
   - Verification: `name`, `verificationLink`, `appName`
   - Password reset: `name`, `link`, `appName`
2. Add their IDs to `.env`:

```env
LOOPS_API_KEY=...
LOOPS_TRANSACTIONAL_VERIFY_ID=...
LOOPS_TRANSACTIONAL_RESET_ID=...
ALLOW_UNVERIFIED_EMAIL_LOGIN=false
```

3. Rebuild/restart the API. `checkEmailConfig()` now returns true, so registration creates
   the account with `emailVerified=false`, sends the Loops verification email, and blocks
   local login until the user clicks the link.

Loops is now the preferred provider; SMTP/Mailgun remain fallbacks for templates that are
not mapped to a Loops transactional ID.

## 3. Bootstrap OpenRouter (optional)

`openrouter-bootstrap` still converges the legacy per-tier guardrails and enables the
filtered model catalog for older deployments. The beta single-key path does not assign keys
to guardrails; tier privacy comes from each endpoint's `addParams`. The check-key command
and management-key expiry warning remain useful:

```
npm run surveil:openrouter-bootstrap
npm run surveil:openrouter-check-key
```

### Subsidized free tier

Signed-up users without a subscription get a per-user OpenRouter key on first use (or at
registration). The key is named `surveil:free:{userId}`, has a **$2/month** limit, resets at
midnight UTC on the first of the calendar month, and is assigned to the shared
`surveil:free` guardrail. No shared key is stored in the environment.

The guardrail's allowlist is derived from the current OpenRouter catalog using these rules:

- text-output chat models only;
- tool calling supported;
- output price at or below **$1 per million tokens** (the pinned model is exempt if
  OpenRouter later raises its list price; free and zero-priced entries are still excluded);
- released within the last **183 days**;
- no `:free`, `:batch`, `openrouter/*`, or `~` router entries;
- at most **10** models, with DeepSeek V4.1 Flash pinned first and the rest sorted by
  release date descending.

Refresh the allowlist without touching any user key after OpenRouter changes its catalog:

```sh
npm run surveil:openrouter-free-sync
```

The global free-tier ceiling is **$10/month**, enforced as a circuit breaker that sums
`usage_monthly` across `surveil:free:*` keys before a free chat starts. Each key's own $2
limit is what prevents individual overages; there is no per-request accounting.

The model picker advertises this catalog on **Max Model Selection** (`Anon`) for
unsubscribed users. Commercial Privacy (`Anon + No Training`) and Enterprise Vault
(`Anon + No Training + ZDR`) show a capped eight-model locked preview, but require an active
paid subscription; direct chat requests to those tiers are rejected. Paid `invoice.paid`
provisioning replaces the free key; free-key cleanup is best effort.

OpenRouter's catalog also contains image, audio, and video generators. The model fetch filters
those to `architecture.output_modalities = ['text']`, so only text-output chat models reach
the picker; sending an image/audio model through the chat route otherwise surfaces as a
provider rate/spend error. OpenRouter's `openrouter/*` meta-routers (including
`openrouter/free`, `openrouter/auto`, and `openrouter/pareto-code`) are excluded because they
are routing entries, not concrete selectable chat models, and can be unavailable to the shared
key. OpenRouter exposes no quality or popularity score, so the remaining models are ranked by
context-window size descending, with newer models as the tie-breaker.

The guardrail allowlist changes whenever OpenRouter adds or retires a compatible model. The
sync command above updates the guardrail and assigns every existing `surveil:free:*` key;
new keys are assigned automatically when they are created.

## Web search (Tavily)

`SEARCH=true` is **not** web search; it enables Meilisearch conversation/message search and
also requires a unique `MEILI_MASTER_KEY`. Tavily web search is configured in `librechat.yaml`:

```yaml
interface:
  webSearch: true

webSearch:
  searchProvider: tavily
  scraperProvider: tavily
  rerankerType: none
  tavilyApiKey: '${TAVILY_API_KEY}'
```

Set `TAVILY_API_KEY` in `.env`, then recreate the API (`up -d --force-recreate api`, no rebuild
needed because the yaml is bind-mounted). The `web_search` tool is offered to chat models that
support tool calling; it cannot be forced onto a model that has no tool support. Tavily is
third-party egress and is only a temporary testing provider.

## 4. Run the stack

```
npm ci
npm run build:data-provider && npm run build:data-schemas && npm run build:api
docker compose -p surveil -f deploy-surveil.yml up -d --build   # http://localhost:3080
```

`docker-compose.override.yml` builds this repo (the upstream compose only pulls a prebuilt
image), injects `.env`, and runs a `surveil-*` stack on port 3080. The app reads
`librechat.yaml` (tracked) for the three tier endpoints. Both compose paths mount it
(`docker-compose.override.yml` for local dev, `deploy-surveil.yml` for prod-mode local
builds and the VPS) because `.dockerignore` excludes `librechat*` from the image — without
the mount the app boots with no tier endpoints and `surveil.enabled` is false, which hides
the credits widget and the Stripe plan picker.

`.env` sets `ENDPOINTS=custom`, so the model menu shows only the three privacy tiers; the
built-in provider endpoints (OpenAI, Google, Anthropic, Agents, ...) are hidden.

Because Mongo is not published to the host, run admin scripts inside the container:

```
docker exec surveil-api npm run surveil:openrouter-provision -- <userId>
docker exec surveil-api npm run surveil:verify-tiers -- <userId>
```

Stop / wipe:

```
docker compose -p surveil down       # stop (keeps data)
docker compose -p surveil down -v    # stop and wipe data
```

## 5. Stripe webhook forwarding (manual, separate terminal)

```
stripe listen --forward-to localhost:3080/api/surveil/stripe/webhook
```

Write the CLI signing secret to `.env` (never printed):

```
npm run surveil:stripe-local-secret
```

Set `SURVEIL_STRIPE_WEBHOOK_SOURCE=cli` while forwarding, or `dashboard` to use
`STRIPE_WEBHOOK_SECRET` from a dashboard endpoint.

## 6. Subscribe and provision

Registration creates a per-user `surveil:free:{userId}` key with a **$2/month** limit and
assigns it to the `surveil:free` guardrail. The picker shows the policy-filtered paid-model
catalog on Max Model Selection (maximum ten, newest-first, DeepSeek V4.1 Flash pinned); those
rows are selectable. Commercial Privacy and Enterprise Vault show a capped eight-model locked
preview and are not selectable without a subscription. The key limit is the server-side
enforcement, so a paid call beyond $2 fails at OpenRouter even if the UI is bypassed.

1. Register/sign in, open the sidebar credits widget, choose a plan ($50/$100/$200) — this
   creates a Checkout Session.
2. Pay with a test card (`4242 4242 4242 4242`). The `invoice.paid` webhook starts the period
   and provisions one paid OpenRouter key (stored encrypted; users never see it).
3. Chat on any tier endpoint; the widget decreases after the next reconcile.

Provision/repair or remove keys manually:

```
npm run surveil:openrouter-provision -- <userId>
npm run surveil:openrouter-deprovision -- <userId>
```

## 7. Simulate renewals with a test clock

```
stripe test_helpers test_clocks create --frozen-time $(date -u +%s)
# attach the customer, then advance:
stripe test_helpers test_clocks advance <clock_id> --frozen-time <future_unix_seconds>
```

A renewal (`invoice.paid`, `billing_reason=subscription_cycle`) starts a new period with a
fresh grant and **no carryover**. Cancellation keeps credits usable until `renewsAt`; a failed
payment enters `past_due` then disables keys after the grace period.

## 8. Verify tiers (tiny live budget)

```
npm run surveil:verify-tiers -- <userId>
```

Sends one `max_tokens=1` request per tier and checks routing metadata: Tier 3 selects a ZDR
endpoint, Tier 2 a non-training endpoint, Tier 1 reaches the catalog.

## 9. Enforcement and privacy

- The provider block is injected server-side via endpoint `addParams`; user payloads are
  Zod-stripped and a sanitizer removes any user `provider`/`modelKwargs` on tier endpoints.
  `packages/api/src/surveil/enforcement.spec.ts` proves it for the request-body channel.
- Privacy hygiene: `librechat.yaml` disables web search, code execution, file search, and MCP
  in the UI; do not set provider keys for RAG/STT/TTS/image/OCR/Langfuse/OTel. See the audit
  table in `PLAN.md`.

## 10. Stripe dashboard steps (manual)

Do these once per Stripe account (test mode now, live mode at launch):

1. **Customer Portal** (Settings → Billing → Customer portal): enable it, allow
   customers to switch plans (needed for upgrade/downgrade) and to cancel. Without
   this, `POST /api/surveil/portal` sessions fail.
2. **Webhook endpoint for production** (Developers → Webhooks → Add endpoint):
   URL `https://<your-domain>/api/surveil/stripe/webhook`, events:
   `checkout.session.completed`, `invoice.paid`, `invoice.payment_failed`,
   `customer.subscription.updated`, `customer.subscription.deleted`,
   `charge.refunded`, `charge.dispute.created`. Copy its signing secret into the VPS
   `.env` as `STRIPE_WEBHOOK_SECRET` and set `SURVEIL_STRIPE_WEBHOOK_SOURCE=dashboard`.
   (Local dev uses the CLI forwarder instead: `SURVEIL_STRIPE_WEBHOOK_SOURCE=cli` +
   `STRIPE_WEBHOOK_SECRET_LOCAL` from `npm run surveil:stripe-local-secret`.)
3. **Test clocks for renewal simulation** (no dashboard step; CLI only):
   `stripe test_helpers test_clocks create --frozen-time $(date -u +%s)`, attach the
   customer, then advance to trigger `invoice.paid` with
   `billing_reason=subscription_cycle`.
4. Prices already exist and match the configured IDs ($50/$100/$200 USD monthly in
   the "Surveil Me Not - Sandbox" sandbox — verified via CLI 2026-11-02). `STRIPE_SECRET_KEY`
   must belong to the same account as the prices or checkout fails with
   "No such price".

## 11. API surface

| Route                               | Auth             | Purpose             |
| ----------------------------------- | ---------------- | ------------------- |
| `GET /api/surveil/health`           | none             | liveness            |
| `POST /api/surveil/stripe/webhook`  | Stripe signature | webhook             |
| `POST /api/surveil/checkout`        | JWT              | Checkout Session    |
| `POST /api/surveil/portal`          | JWT              | Billing Portal      |
| `GET /api/surveil/credits`          | JWT              | plan/status/credits |
| `POST /api/surveil/credits/refresh` | JWT              | on-demand reconcile |
| `GET /api/surveil/pricing`          | none             | cached model prices |
| `POST /api/surveil/pricing/refresh` | JWT              | force price refresh |
