# Surveil-Me-Not — local runbook

Privacy-tiered hosted LibreChat. Users subscribe monthly, receive a USD credit grant, and
choose a privacy tier by choosing a model endpoint. Spend is metered from OpenRouter's
reported per-key usage; privacy is enforced by OpenRouter key guardrails plus a server-injected
`provider` block. See `PLAN.md` for the design and `AGENTS.md` for contribution rules.

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
```

Verify presence without printing values:

```
npm run surveil:check-env
```

The app refuses to start with a live Stripe key unless `SURVEIL_ALLOW_LIVE_STRIPE=true`.

## 3. Bootstrap OpenRouter (once)

Creates/converges the three tier guardrails, enables the filtered model catalog, and warns
about management-key expiry:

```
npm run surveil:openrouter-bootstrap
npm run surveil:openrouter-check-key
```

Guardrails (Default Workspace): `surveil:tier1`/`tier2` (spend limit only) and
`surveil:tier3` (all five `enforce_zdr_*` flags). Tier 2 relies on the request-level
`provider.data_collection="deny"`; Tier 3 also sends `provider.zdr=true`.

## 4. Run the stack

```
npm ci
npm run build:data-provider && npm run build:data-schemas && npm run build:api
docker compose -p surveil up -d --build   # surveil-* stack, http://localhost:3080
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

Registration already provisioned three limit-0 OpenRouter keys (one per tier) when
`surveil.provisionOnRegistration: true` (set in `librechat.yaml`): the picker fetches the
live guardrail-filtered catalog with the user's own key, free models (zero price) are
listed first and selectable, and paid models stay visible but locked until a subscription
is active. The key limit (0) is the server-side enforcement — a paid call without credits
fails at OpenRouter even if the UI is bypassed.

1. Register/sign in, open the sidebar credits widget, choose a plan ($50/$100/$200) — this
   creates a Checkout Session.
2. Pay with a test card (`4242 4242 4242 4242`). The `invoice.paid` webhook starts the period
   and provisions one OpenRouter key per tier (stored encrypted; users never see them).
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
   the "luna helper 50-100-200" sandbox — verified via CLI 2026-11-02). `STRIPE_SECRET_KEY`
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
