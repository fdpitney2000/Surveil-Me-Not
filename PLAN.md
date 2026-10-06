# Surviel-Me-Not — MVP Plan (privacy-tiered hosted LibreChat)

Status: **PLAN ONLY — awaiting approval. No code written.**
Author: implementation agent. Date: 2026-10-05.
Upstream baseline: LibreChat `v0.8.8-rc4` (commit `63363a777`).

---

## 0. TL;DR

- The product claim (privacy enforced on *every* model call) is achievable with LibreChat's
  custom-endpoint `addParams` **plus** OpenRouter key-level guardrails. `addParams` supports
  nested objects and is applied after user-supplied parameters on every custom-endpoint path,
  and user request payloads are Zod-stripped so they cannot inject a `provider` block.
- We keep **3 OpenRouter keys per user (one per tier)** so Tier 3 ZDR and Tier 2 no-training are
  enforced by the key's guardrail at OpenRouter, independent of anything LibreChat sends.
- Tier 2 should get training-disable guardrail flags in addition to the request-level
  `data_collection: "deny"` (a hardening beyond the spec; flagged in §5.2 for your approval).
- The main correctness gap is the **shared credit pool across 3 keys**: per the spec's formula
  each key can independently overspend by `remaining`, so worst case is ~`3 × grant`. §5.4
  proposes an allocation strategy that bounds it to ~`1 × grant` plus one in-flight request.
- Several environment discrepancies and blocking questions are in §14. **These need answers
  before phase 1.**

---

## 1. Environment findings and discrepancies

| Item | Spec says | Actual | Action |
|---|---|---|---|
| Repo | clone of `fdpitney2000/Surviel-Me-Not` (fork of LibreChat v0.8.8) | `/Users/fdp/librechat2` origin = `danny-avila/LibreChat.git`, `main` @ `v0.8.8-rc4` | **Ask (Q1)** |
| Nested dir | — | `librechat2/` is a *separate* git repo, origin `fdpitney2000/librechat2.git`, single "Initial commit", only `LICENSE`/`.gitattributes` | Ignore unless you say otherwise |
| Branch | `mvp` | current branch `main`; no `mvp` exists | Create `mvp` from `main` after Q1 |
| upstream remote | add `LibreChat-AI/LibreChat` if missing | origin is already canonical LibreChat; no `upstream` remote | **Ask (Q1)** |
| Secrets | `OPENROUTER_MANAGEMENT_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` in gitignored `.env` | These variable names were **not set** in the workspace `.env` I inspected (only LibreChat bootstrap keys + `OPENROUTER_KEY` empty). I did not print values. | **Ask (Q2)**; `surviel:check-env` will report precisely |
| Docker | MVP via Docker | `docker-compose.yml` (upstream) exists; untracked `docker-compose.librechat2.yml` overrides container names and builds `librechat2-local` | **Ask (Q10)** |
| Ports | 3080 | `.env` uses `PORT=3081`, `DOMAIN_*:3081` | Note for docs |
| Stripe CLI | installed, TEST mode | `stripe 1.50.10`, sandbox `acct_1UCmlXR35hoGDQ2E`, `livemode:false` | OK |
| Stripe prices | $50/$100/$200 monthly | Confirmed via CLI: `price_1UCmtfR35hoGDQ2ENiQn79YJ`=5000, `...EwXZj3QCg`=10000, `...E5eCt2WRO`=20000, all USD, `interval=month`, active | OK |
| Node/npm | — | Node v26.8.2, npm 11.19.1 | OK |

`git status` also shows untracked `images/`, `uploads/`, `logs/`, `data-node/`, `meili_data_v1.35.1/`,
`librechat.yaml`, `docker-compose.librechat2.yml`. These are runtime/local artifacts.

---

## 2. Code findings (baseline for the design)

### 2.1 `addParams` / `dropParams` (custom endpoints)

- Schema: `packages/data-provider/src/config.ts`
  - `paramValueSchema` is recursive — **nested objects and arrays are allowed** (`config.ts:565-572`).
  - `addParamsSchema` = `z.record(z.string(), paramValueSchema)` with a `web_search` boolean
    refinement (`config.ts:576-585`).
  - Custom endpoint fields `addParams` (`:1737`), `dropParams: string[]` (`:1738`);
    Azure groups carry the same (`:597-598`).
  - Test proving nested objects: `packages/data-provider/specs/config-schemas.spec.ts:298-305`.
  - Whole YAML validated with `configSchema.strict().safeParse` → **unknown top-level keys are
    rejected** (`packages/api/src/app/loader.ts:246`).
- Runtime application (OpenAI-compatible path): `packages/api/src/endpoints/openai/llm.ts`
  - `addParams` loop `:743-806`. Known OpenAI params go onto `llmConfig`; **everything else is a
    shallow `modelKwargs[key] = value`** (`:801-804`). `provider` is not a known OpenAI param, so
    `provider: { ... }` lands verbatim in `modelKwargs.provider`. **No deep merge.**
  - `dropParams` `:1008-1010` via `deleteConfigParam` (`:207-252`) deletes a *top-level* key from
    both `llmConfig` and `modelKwargs`. `dropParams: ['provider']` would delete our injection, so
    we must not set it.
  - Final `llmConfig.modelKwargs = modelKwargs` at `:1069-1071`.
  - OpenRouter detection + headers: `packages/api/src/endpoints/openai/config.ts:20-41,117-122,232-241`.
- `transformToOpenAIConfig` re-applies add/drop shallowly: `packages/api/src/endpoints/openai/transform.ts:94-133`.

### 2.2 Every outbound custom-endpoint path

All chat traffic goes through the agents route. `createPayload` hard-codes the agents URL
(`packages/data-provider/src/createPayload.ts:41-49`). Regenerate/continue/edit/compact are flags
on the same payload (`createPayload.ts:17-24,59-63`).

| Path | Entry | `addParams` applied? |
|---|---|---|
| chat / regenerate / continue / edit / compaction | `api/server/routes/agents/chat.js:87` → `packages/api/src/agents/initialize.ts:1299-1321` | Yes |
| Agents (persisted / ephemeral) | same `initializeAgent`, merge at `initialize.ts:1280-1286` | Yes |
| Title generation (`titleConvo`) | `api/server/controllers/agents/client.js:5985,6031` | Yes |
| Summarization / compaction (cross-endpoint) | `packages/api/src/agents/run.ts:1143,1227-1228,1264-1265` | Yes for OpenAI-compatible |
| Activity / reasoning labels | `packages/api/src/agents/activityLabels/host.ts:300,391` | Yes |

**Bypass found:** a custom endpoint with `provider: 'anthropic'` (native `/v1/messages` client)
skips `transformToOpenAIConfig` (`packages/api/src/endpoints/custom/initialize.ts:323-335`) and the
Anthropic builder drops unknown `addParams` (`packages/api/src/endpoints/anthropic/llm.ts:334-376`).
→ **Decision: our three endpoints must NOT set `provider: anthropic`.** OpenRouter is
OpenAI-compatible, so this is fine.

### 2.3 Can users override/strip the `provider` block?

- Normal chat payloads are Zod-stripped: `parseCompactConvo` → `openAISchema`/`compactAgentsSchema`
  (`packages/data-provider/src/parsers.ts:324-335`, `schemas.ts:1669-1675,1741-1754`). There is no
  `provider`, no `modelKwargs`, no `dropParams` field. ✅
- Agent create/update accepts `model_parameters` as an open `z.record(z.unknown())`
  (`packages/api/src/agents/validation.ts:573,627`). A user with agent-write permission could store
  arbitrary keys. Merge order is base `{model}` < agent `model_parameters` < request
  `endpointOption.model_parameters` (`initialize.ts:1280-1286`), then **admin `addParams` runs after**
  and, because it contributes an unknown key, the final `llmConfig.modelKwargs = modelKwargs`
  (`llm.ts:1069-1071`) **discards any user-supplied `modelKwargs`**. So the admin `provider` wins for
  Tiers 2/3.
- Residual risk: a user top-level `model_parameters.provider` would land in `llmConfig.provider`,
  a different channel from `modelKwargs.provider`. It is not a known ChatOpenAI body param, so it
  should be ignored, but this must be **proven by test** (phase 5). A defensive sanitizer for the
  surviel endpoints is proposed in §5.5.
- `dropParams` is admin-only (endpoint schema), never user-controllable. ✅

### 2.4 Per-user encrypted key store

- User-provided endpoint keys live in the `Key` collection, not on `User`:
  `packages/data-schemas/src/schema/key.ts:3-34` (`{userId, name, value(encrypted), expiresAt}`).
- Encryption: `packages/data-schemas/src/crypto/index.ts:9-65` (AES-CBC, `CREDS_KEY`/`CREDS_IV`).
- Methods: `packages/data-schemas/src/methods/key.ts` — `getUserKey:33`, `getUserKeyValues:60`
  (JSON.parses to `{apiKey, baseURL}`), `updateUserKey:113` (encrypts + upsert), `deleteUserKey:152`.
- Custom endpoint resolution: `packages/api/src/endpoints/custom/initialize.ts:178-354`.
  `apiKey: 'user_provided'` → `isUserProvided` → `db.getUserKeyValues({userId, name: endpoint})`
  (`:205-221`), then `getOpenAIConfig(apiKey, ...)` (`:341`).
- Client cannot read key material:
  - `GET /api/user` uses `PUBLIC_USER_RESPONSE_FIELDS` allow-list, no keys
    (`api/server/controllers/UserController.js:45-64,76-95`).
  - `GET /api/keys` returns only expiry, never value (`api/server/routes/keys.js:34-38`).
  - `loadCustomEndpointsConfig` exposes `userProvide`/`modelDisplayLabel` etc., never `apiKey`
    (`packages/api/src/endpoints/custom/config.ts:60-73`). ✅

### 2.5 Registration / deletion / auth cache

- Registration choke point: `api/server/services/AuthService.js:374-460` (`createUser` at `:434`,
  rollback catch at `:450-459`). Covers local, social, OIDC.
- Account deletion: `api/server/controllers/UserController.js:396-603`; existing key cleanup
  `await db.deleteUserKey({ userId: user.id, all: true })` at `:507`; `deleteUserById` at `:528`.
  The controller is explicitly retry-safe (`:420-444`, `:557-602`).
- Auth user-doc cache: `packages/api/src/auth/userDocCache.ts` + invalidation at
  `packages/data-schemas/src/methods/user.ts:330-350`. **Only needed if we add fields to the user
  document.** Writing to the separate `Key` collection needs no invalidation. Our plan keeps new
  state in new collections + the existing `Key` store.

### 2.6 Routes, mounting, raw-body webhook

- Route aggregation: `api/server/routes/index.js` (add `surviel`).
- Mount block: `api/server/index.js:403-458`; must be before `app.use('/api', routes.openapi)` (`:458`).
- **Raw body problem:** global `express.json({limit:'3mb'})` at `api/server/index.js:342` runs before
  any route router, so a router-level `express.raw` would see an already-parsed body and the Stripe
  signature would fail. Options (choose one):
  1. Register the webhook with `express.raw` **before** line 342 (early `app.post`), or
  2. add a `verify` callback to the global `express.json` capturing `req.rawBody` for that path, or
  3. path-guard the global parser.
  → **Decision: option 2** (one-line, lowest-risk, no route ordering games; see §7.3).
- Test expectations to update if route strings change: `api/server/index.spec.js`,
  `api/server/experimental.spec.js:124-129`.

### 2.7 Reconciler / background job pattern

No generic scheduler. The pattern to copy is the leader-gated `setInterval` reconciler:
`packages/api/src/code/lifecycle.ts:378-400` (`isLeader()`, `unref()`, in-flight guard). Started
from `startServer()` (near `connectDb()` / `startCodeEnvironmentLifecycleReconciler` at
`api/server/index.js:196-199`). Leader election: `packages/api/src/cluster/LeaderElection.ts:129-154`.

### 2.8 Config schema / env

- `configSchema` top-level `packages/data-provider/src/config.ts:3093-3236`; loader is `.strict()`,
  so a new `surviel` section must be added to the schema.
- Endpoint schema `config.ts:1709-1767`; base endpoint `:678-761`; per-model `description` exists
  (`modelItemSchema:781-787`) but **no per-endpoint `description`** and **no way to hide the
  `userProvide` key prompt**.
- Env is read directly via `process.env.*`; no central registry. Required-credential validation
  lives in `packages/api/src/credentials.ts:5-10`.

### 2.9 Native balance — explicitly NOT used

- `Balance`/`Transaction` schemas + methods are a disabled-by-default post-hoc token ledger
  (`packages/data-schemas/src/methods/transaction.ts`, `spendTokens.ts`). Prices are static in
  `packages/data-schemas/src/methods/tx.ts` with a `defaultRate = 6` fallback. Balance config
  `config.ts:2790-2803`. → **Do not use for enforcement or metering**; leave `balance.enabled` off.

### 2.10 Admin Panel

- The panel is an **external app** (`ADMIN_PANEL_URL`), backed by `/api/admin/*`. It edits
  per-principal config overrides (Mongo `Config` docs) and role/group permissions, validated per
  section. Not needed for MVP; we will not depend on it.

---

## 3. OpenRouter findings (verified against docs)

### 3.1 Guardrails (`POST/PATCH /api/v1/guardrails`, `POST /api/v1/guardrails/{id}/assignments/keys`)

- Fields include `limit_usd` + `reset_interval` (daily|weekly|monthly), `allowed_models`,
  `allowed_providers`, `ignored_*`, `enforce_zdr_*`, and training/publication flags
  `enable_free_model_training`, `enable_paid_model_training`, `enable_free_model_publication`.
- ZDR model groups are **five**: `enforce_zdr_anthropic`, `enforce_zdr_openai`,
  `enforce_zdr_google`, `enforce_zdr_xai` (SpaceXAI), `enforce_zdr_other`. Legacy `enforce_zdr` is
  deprecated (copied into unspecified per-group fields).
- Assign keys: `POST /guardrails/{id}/assignments/keys` body `{ key_hashes: [hash, ...] }`.
  A key may hold **at most one** guardrail; assigning replaces.
- Budgets are **per key/member, not shared across keys**. `include_byok_in_budgets` defaults false.

### 3.2 API keys (`/api/v1/keys`)

- Create: `POST` `{name, limit, limit_reset, disabled, expires_at, external}`; response returns
  plaintext `key` **once** plus `data.hash`, `data.usage` (USD), `data.label`.
- Update: `PATCH /keys/{hash}` accepts only `disabled`, `include_byok_in_limit`, `limit`,
  `limit_reset`, `name` (unrecognized ignored; empty body → 400).
- `usage` is lifetime OpenRouter-credit spend for that key (excludes BYOK). This is our source of truth.

### 3.3 Organization settings

- `PATCH /api/v1/organization/settings` `{ is_filtered_model_catalog_enabled: true }`. Then
  `GET /api/v1/models` called **with one of the org's API keys** returns only models that key may
  use; `GET /api/v1/models/user` is the filtered catalog endpoint. **Personal management keys get
  404** from org routes → we need an **organization** management key (Q7).

### 3.4 ZDR endpoint list

- `GET /api/v1/endpoints/zdr` returns `{data:[{name, model_name, provider_name,
  supports_implicit_caching}]}`. Used by the `verify-tiers` script and optional Tier 3 picker seed.

### 3.5 Usage accounting / per-message cost

- **Every** OpenRouter response includes a `usage` object with `cost` (credits) and
  `cost_details`; streaming includes it in the final chunk. `usage:{include:true}` and
  `stream_options` are deprecated/no-op. → per-message cost display is feasible; parse `usage.cost`.
- `GET /api/v1/credits` returns **account-wide** `{total_credits,total_usage}` — not per user. We use
  per-key `usage` for the ledger; `credits` is only an operator health signal.

### 3.6 Provider block shape

```jsonc
// Tier 2 addParams
{ "provider": { "data_collection": "deny" } }
// Tier 3 addParams
{ "provider": { "zdr": true, "data_collection": "deny" } }
```
Request-level `zdr` ORs with account/guardrail ZDR (can only add enforcement, never remove). ✅

---

## 4. Tier design (as specified)

| Tier | Endpoint name | Guardrail | Request `addParams` |
|---|---|---|---|
| 1 | Max Model Selection | spend limit only | *(none)* |
| 2 | Commercial Privacy | spend limit only (+ **proposed** training flags) | `provider:{data_collection:"deny"}` |
| 3 | Enterprise Vault | all five `enforce_zdr_* = true` | `provider:{zdr:true,data_collection:"deny"}` |

The three custom endpoints share `baseURL: https://openrouter.ai/api/v1`,
`apiKey: 'user_provided'`, `models.fetch: true`, `titleConvo: true` (same endpoint), no `provider`
field, and a new per-endpoint one-line `description` (see §7.1).

---

## 5. Decisions on open items

### 5.1 Three keys vs one key — **recommend 3 keys**

| | 3 keys (per tier) | 1 key |
|---|---|---|
| Tier 3 ZDR | enforced by key guardrail at OpenRouter, independent of request | only request `provider.zdr` + (account-wide, which would hit Tier 1 too) |
| Tier 2 no-training | key guardrail can enforce | request only |
| Pool math | 3 limits to reconcile; overspend risk (see 5.4) | single limit, bound ~`1×remaining` |
| Provisioning | 3 keys + 3 assignments per user | 1 key |
| Blast radius | a leaked key is tier-scoped | leaked key has full catalog |

Recommendation: **3 keys**. The product's differentiator is key-level, non-bypassable enforcement;
a single key cannot provide Tier 3 without applying ZDR account-wide (which breaks Tier 1). Cost is
reconciler complexity, which we bound in 5.4.

### 5.2 Tier 2 guardrail hardening — **recommend, needs your approval**

The spec says Tier 2's guardrail has "spend limits only". OpenRouter guardrails expose
`enable_free_model_training` / `enable_paid_model_training` / `enable_free_model_publication`.
Setting all three to `false` enforces "no training on request data" **at the key**, which is the
actual Tier 2 guarantee and removes reliance on the request-level `data_collection: "deny"`.
I recommend adding them (defense in depth), keeping the request-level param too. If you prefer to
match the spec exactly, Tier 2's guarantee rests solely on `addParams`.

### 5.3 Hiding the user-provided key prompt — **minimal upstream change**

Using `apiKey: 'user_provided'` triggers the server-side per-user key lookup we want, but
`loadCustomEndpointsConfig` sets `userProvide: true` (`custom/config.ts:62`), so the UI would ask
users to paste a key. We need to hide that. Proposal: add an optional endpoint field
`hideUserProvidedKey?: boolean` to `endpointSchema`, and in `loadCustomEndpointsConfig` set
`userProvide: isUserProvided(...) && !endpoint.hideUserProvidedKey`. Set it true on all three
endpoints. This is ~4 lines in upstream files plus the schema field; new behavior lives in config.
(Alternative: a bespoke `apiKeySource: 'surviel'` hook — larger change, not preferred.)

### 5.4 Shared pool and worst-case overspend — **needs your decision**

Per the spec formula `limit_i = usage_i + max(remaining,0)` applied to all three keys:

- Each key gets `limit_remaining = remaining`, so a user who spreads spend across all three keys
  can spend up to **`3 × remaining`** before the next reconcile, i.e. worst case ≈ **`3 × grant`**
  in a single period (if snapshot usage is 0), plus the cost of one in-flight request.
- Typical users pick one tier → practical bound ≈ `remaining` + one request.

Recommended mitigation (bounds to ≈ `remaining` + one request): **allocate the pool to the active
tier**. Keep a persisted `activeTier` (last endpoint used). On reconcile and on-demand refresh:
set the active tier's key `limit = usage_i + remaining`, and set the other two keys'
`limit = usage_i` (no headroom) or `usage_i + reserve` (small reserve, e.g. $0.10). Switching tiers
triggers an on-demand reconcile so the newly active key gets the pool. This keeps the worst case at
~`1× remaining` while preserving "choose a tier per conversation".

I recommend **allocate-to-active**. If you prefer the literal spec formula, we ship `duplicate`
mode and document the `3×` bound. Both will be configurable
(`surviel.keyLimitMode: 'allocate' | 'duplicate'`, default `allocate`).

Independent of mode: cap `max_tokens` when remaining is low (e.g. remaining <
`surviel.lowBalanceMaxTokensThreshold` → cap `max_tokens` to `surviel.maxTokensCap`), so a single
request cannot overshoot wildly.

### 5.5 Enforcement contingency — proxy

If phase-5 tests show any path where the `provider` block can be stripped, we add a thin
server-side proxy in front of OpenRouter (`surviel.proxy.enabled`, default off): LibreChat's
endpoint `baseURL` points at `/api/surviel/proxy/{tier}`, which resolves the user's key/tier,
injects/overwrites `provider`, strips any client-supplied `provider`, and forwards. The proxy is
also the airtight fix for the `model_parameters.provider` residual risk. Plan includes the design
but we do not build it unless tests require it. A defensive sanitizer for the surviel endpoints
(delete `provider`/`modelKwargs` from agent `model_parameters` before `getOptions`) is the lighter
option and will be included in phase 5 regardless.

### 5.6 Pricing service — display only

- Fetch `GET /api/v1/models` pricing fields (`pricing.prompt`/`completion` are USD **per token**
  as strings). Cache with `surviel.pricing.ttlMs` (default 3600000), stale-while-revalidate, manual
  refresh endpoint `POST /api/surviel/pricing/refresh` (admin/operator) and script.
- Display price per 1M tokens in the picker and per-message cost from `usage.cost` in responses.
- Price changes affect burn-rate display only; **ledger integrity comes from OpenRouter key `usage`**.

### 5.7 Period model / lifecycle

- On `invoice.paid` with `billing_reason ∈ {subscription_create, subscription_cycle}`: start a new
  period; snapshot per-key lifetime usage; `grant = planPrice × creditGrantRatio`; store an
  idempotent `SurvielPeriod` keyed by `invoice.id`.
- `remaining = grant - (Σ current lifetime usage − Σ snapshot usage)`, floored at 0.
- `invoice.payment_failed` → `past_due`; after `surviel.graceDays` disable keys.
- `customer.subscription.deleted` → keys disabled at `current_period_end`; credits usable until then.
- `charge.refunded` / `charge.dispute.created` → disable keys + `flaggedForReview=true`.
- **Upgrade:** immediate; grant prorated credit difference (`(newPrice-oldPrice) × ratio ×
  remainingFractionOfPeriod`) as an extra period entry, reconcile immediately. **Downgrade:** at next
  renewal (plan change stored, applied on `subscription_cycle`).
- All money integer micro-USD (`Math.round(usd * 1_000_000)`); no floats in the ledger.

### 5.8 Guardrail bootstrap

Idempotent `surviel:openrouter-bootstrap`:
1. `GET /api/v1/guardrails`, match by `name` (`surviel:tier1|2|3`), create missing.
2. Tier 1/2: `limit_usd = surviel.guardrailBackstopUsd` (default max grant = 180) +
   `reset_interval: monthly`. Tier 2 additionally training flags (5.2). Tier 3: the five
   `enforce_zdr_* = true`.
3. Persist IDs in a small `SurvielSetting` doc.
4. Enable `is_filtered_model_catalog_enabled` via `PATCH /api/v1/organization/settings`.

### 5.9 Model catalog / pickers

- Primary: org filtered catalog (enabling the setting makes LibreChat's per-user `/models` fetch
  return the key-filtered list). Verify LibreChat uses the user key for custom-endpoint model fetch
  (`packages/api/src/endpoints/config/models.ts:101-219`).
- Tier 3 optional seed: derive `models.default` from `GET /api/v1/endpoints/zdr` at bootstrap.
- Tier 2: no endpoint-level data-policy field is exposed by `/models`; rely on the guardrail +
  filtered catalog and surface routing errors clearly (the request-level `data_collection: deny`
  makes OpenRouter reject non-compliant providers with 403).

### 5.10 Management-key expiry / rotation

- Management keys expire and cannot be extended. Store `SURVIEL_OPENROUTER_MGMT_KEY_EXPIRES_AT`
  (optional). Log a warning at startup and in the reconciler when
  `now > expiresAt - surviel.mgmtKeyWarnDays`. Provide `surviel:openrouter-check-key` to verify the
  key and print expiry (redacted). Rotation = set a new env value and restart; guardrail/key IDs are
  stable and need no migration.

---

## 6. Final architecture

### 6.1 Components

```
client (React)
  CreditsWidget / PerTierBreakdown / PricingPrompt / LowBalanceNotice / ManageSubscription
        │ React Query
        ▼
/api/surviel/*  (thin CJS router, api/server/routes/surviel.js)
        │ delegates
        ▼
packages/api/src/surviel/*  (all behavior)
  config · money · openrouter/{client,guardrails,keys,usage} · pricing/service
  subscription/{store,period,checkout} · stripe/{client,webhook}
  reconciler · credits · provision · errors
        │
        ├── packages/data-schemas (new schemas + methods)
        ├── OpenRouter Management API  (guardrails, keys, org settings, models, zdr)
        └── Stripe API (checkout, portal, webhooks)
```

### 6.2 Data model (new collections; all money micro-USD integers)

- `SurvielSubscription` (unique `userId`): `stripeCustomerId`, `stripeSubscriptionId`, `priceId`,
  `plan`, `status` (`active|past_due|grace|disabled|canceled|review`), `periodStart`, `renewsAt`,
  `grantMicroUsd`, `snapshotByTier` (`{tier1,tier2,tier3}` lifetime usage at period start),
  `activeTier`, `graceUntil`, `flaggedForReview`, `lastSyncedAt`, `lastEventCreatedAt`, timestamps.
- `SurvielPeriod` (unique `invoiceId`): `userId`, `plan`, `grantMicroUsd`, `snapshotByTier`,
  `periodStart`, `periodEnd`, `kind` (`cycle|proration`), `createdAt`.
- `SurvielKey` (unique `{userId,tier}`): `keyHash`, `keyName` (`surviel:{userId}:{tier}`),
  `guardrailId`, `disabled`, `lastUsageMicroUsd`, `createdAt`. Plaintext key lives only in the
  encrypted `Key` collection under the endpoint name.
- `SurvielEvent` (unique `eventId`): `type`, `processedAt`, `createdAt` (Stripe event created).
- `SurvielSetting` (singleton/keys): guardrail IDs, pricing cache pointer, catalog flag.

### 6.3 Subscription → provisioning flow

1. User clicks Subscribe → `POST /api/surviel/checkout` → Stripe Checkout Session (`mode:
   subscription`, `line_items:[price]`, `client_reference_id:userId`, `metadata.userId`,
   `subscription_data.metadata.userId`, success/cancel URLs). Create/reuse `stripeCustomerId`.
2. `checkout.session.completed` → link customer/subscription to user (idempotent).
3. `invoice.paid` (create/cycle) → create `SurvielPeriod` (unique invoice id), snapshot usage,
   set grant, then **provision keys idempotently**:
   - For each tier: if `SurvielKey` exists → verify via `GET /keys/{hash}`; else create
     `POST /keys {name, limit: 0, limit_reset: null}` → store plaintext into `Key` collection
     (`updateUserKey({userId, name: endpointName, value: JSON.stringify({apiKey})})`), store hash.
   - Assign each hash to its guardrail (`POST /guardrails/{id}/assignments/keys`).
   - Retry-safe: keys are looked up by name/hash before creation; the encrypted store is upsert.
4. Reconcile immediately, then on the interval.
5. No subscription → no keys. Chat middleware returns a stable coded error
   (`SURVIEL_NO_SUBSCRIPTION`); client shows the pricing prompt and blocks send.

### 6.4 Reconciler flow (leader-gated, `setInterval`, default 2 min)

For each subscription in an active-ish status:
1. Fetch per-key `usage` (batched list, name prefix `surviel:`; paginate).
2. `spent = Σ usage − Σ snapshot`; `remaining = max(grant − spent, 0)`.
3. Apply `keyLimitMode` (5.4) to set each key's `limit` via `PATCH /keys/{hash}`.
4. Disable all keys when `remaining ≤ 0` or status not usable; re-enable on renewal/upgrade.
5. Persist `lastSyncedAt`, `snapshotByTier`, `activeTier`.
6. On-demand refresh endpoint `POST /api/surviel/credits/refresh` (rate-limited).

### 6.5 Credits API — `GET /api/surviel/credits`

```json
{ "plan":"100", "status":"active", "periodStart":"...", "renewsAt":"...",
  "grantUSD":90.0, "spentUSD":12.34, "remainingUSD":77.66,
  "perTier":{"tier1":1.0,"tier2":2.0,"tier3":9.34}, "lastSyncedAt":"..." }
```
(Micro-USD integers internally; JSON exposes numeric USD for display plus raw micro fields if needed.)

### 6.6 UI

- Persistent sidebar/nav widget: remaining USD, usage bar, renews-at + "unused credits expire",
  click → per-tier breakdown, low-balance warning at `surviel.lowBalanceThresholdUsd`,
  "Manage subscription / Upgrade" (Stripe portal session), exhausted state.
- In-chat message when exhausted/no subscription with renewal date + upgrade.
- Tier guarantee one-liner from the new per-endpoint `description`.

---

## 7. File-level change list

### 7.1 New backend — `packages/api/src/surviel/` (behavior)

- `config.ts` — resolve `surviel` yaml + env, tier defs, guardrail names, fee math, constants.
- `money.ts` — micro-USD helpers (`toMicro`, `fromMicro`, `formatUsd`).
- `errors.ts` — stable codes (`SURVIEL_NO_SUBSCRIPTION`, `SURVIEL_CREDITS_EXHAUSTED`, …).
- `openrouter/client.ts` — Management API client (redacting logger; never logs key strings).
- `openrouter/guardrails.ts` — idempotent bootstrap.
- `openrouter/keys.ts` — create/list/update/delete/assign; name convention.
- `openrouter/usage.ts` — per-key usage fetch.
- `openrouter/catalog.ts` — filtered catalog / ZDR endpoint list.
- `pricing/service.ts` — fetch/cache/SWR/manual refresh.
- `subscription/store.ts` — persistence via data-schemas methods.
- `subscription/period.ts` — period/credit math (integer micro-USD) + proration.
- `subscription/checkout.ts` — Checkout + portal sessions.
- `stripe/client.ts` — Stripe init + test-mode guard (refuse live unless override).
- `stripe/webhook.ts` — signature verify, idempotency, event handlers.
- `reconciler.ts` — leader-gated periodic job + on-demand.
- `provision.ts` — idempotent key provisioning + deletion.
- `credits.ts` — credits response builder.
- `index.ts` — exports.

### 7.2 New data layer — `packages/data-schemas/src/`

- `schema/survielSubscription.ts`, `schema/survielPeriod.ts`, `schema/survielKey.ts`,
  `schema/survielEvent.ts`, `schema/survielSetting.ts`.
- `methods/surviel.ts` (or split) + register in `models/index.ts`, `methods/index.ts`.

### 7.3 Wiring — `/api` (thin, per AGENTS.md)

- `api/server/routes/surviel.js` — require `@librechat/api` surviel handlers; router.
- `api/server/routes/index.js` — add + export `surviel`.
- `api/server/index.js`:
  - `express.json({ ..., verify: captureRawBodyForSurviel })` at `:342` (one-line + tiny helper).
  - `app.use('/api/surviel', routes.surviel);` before `:458`.
  - start `startSurvielReconciler({ mongoose })` near `:199`.
  - update route-string tests.
- `api/server/services/AuthService.js` — **no** provisioning hook needed (provision on payment).
- `api/server/controllers/UserController.js:507` — add OpenRouter key deletion
  (`survielDeleteUserKeys`) beside `db.deleteUserKey`.

### 7.4 Shared config/types — `packages/data-provider/src/`

- `config.ts`: add `surviel` section to `configSchema` (all levers with defaults); add endpoint
  fields `description?: string` and `hideUserProvidedKey?: boolean`; add `SurvielConfig` type.
- `keys.ts`: React Query keys (`survielCredits`, `survielPricing`).
- new `surviel.ts` (or `types/surviel.ts`): shared credits/plan/tier types + endpoint defs.
- `packages/api/src/endpoints/custom/config.ts`: honor `hideUserProvidedKey`; surface `description`.

### 7.5 Client — `client/src/`

- `components/Surviel/CreditsWidget.tsx`, `PerTierBreakdown.tsx`, `PricingPrompt.tsx`,
  `LowBalanceNotice.tsx`, `ManageSubscription.tsx` + colocated `__tests__`.
- `hooks/Surviel/useCredits.ts`, `useCheckout.ts`, `usePortal.ts` (React Query).
- Integrate widget into nav/sidebar; integrate exhausted/no-subscription into chat send path.
- `locales/en/translation.json` — new keys only.

### 7.6 Config / scripts / env / docs

- `librechat.yaml` — three custom endpoints with `addParams`, `description`, `hideUserProvidedKey`,
  `apiKey: user_provided`, `baseURL`, `models.fetch`, `titleConvo` same endpoint.
- `librechat.example.yaml` — documented `surviel` block + endpoints.
- `.env.example` — variable **names** only (see §12).
- `scripts/surviel/*.mjs` + `package.json` scripts (§8).
- `docs/surviel.md` — full local flow incl. Stripe CLI forwarding + test clocks.
- `Dockerfile`/compose — only if Q10 requires.

---

## 8. Tooling / scripts

| Script | Purpose |
|---|---|
| `npm run surviel:check-env` | Report set/unset per required var **without printing values**; exit nonzero if missing |
| `npm run surviel:stripe-local-secret` | `stripe listen --print-secret` → write `STRIPE_WEBHOOK_SECRET_LOCAL` to `.env` (never echo) |
| `npm run surviel:openrouter-bootstrap` | Idempotent guardrails + org filtered-catalog flag |
| `npm run surviel:openrouter-provision -- <userId>` | Provision/repair 3 keys for a user |
| `npm run surviel:openrouter-deprovision -- <userId>` | Delete keys + local refs |
| `npm run surviel:openrouter-refresh-pricing` | Manual pricing refresh |
| `npm run surviel:openrouter-check-key` | Verify management key + print expiry (redacted) |
| `npm run surviel:verify-tiers` | Tiny live budget; prove routing per tier (§10) |

All OpenRouter scripts load `OPENROUTER_MANAGEMENT_KEY` from `.env`, redact all output, and send
created key strings **straight to the encrypted store**, never to stdout/logs.

---

## 9. Net-margin table

Fees (configurable): `STRIPE_FEE_PCT=2.9`, `STRIPE_FEE_FIXED=0.30`,
`OPENROUTER_FEE_PCT=?` (**need your Enterprise terms — Q3**), `CREDIT_GRANT_RATIO=0.9`.

`margin(u) = price − stripeFee − grant × u × (1 + openrouterFee)`, `grant = price × 0.9`.

| Plan | Price | Stripe fee | Grant | Margin @ u=1.0, fee=0% | fee=5% | fee=7.5% | fee=10% | Margin @ u=0.5, fee=5% |
|---|---|---|---|---|---|---|---|---|
| 50 | $50 | $1.75 | $45 | +$3.25 | **+$1.00** | **−$0.13** | −$1.25 | +$23.13 |
| 100 | $100 | $3.20 | $90 | +$6.80 | +$2.30 | −$0.15 | −$2.20 | +$46.05 |
| 200 | $200 | $6.10 | $180 | +$13.90 | +$4.90 | −$0.40 | −$4.10 | +$92.35 |

⚠️ **The $50 plan is the fragile one.** At full utilization it turns negative once the OpenRouter
credit-purchase fee exceeds ~7.2%. If your Enterprise fee is ≥7%, we should either raise
`STRIPE_FEE` assumptions, lower `CREDIT_GRANT_RATIO`, or reprice $50. Breakage (u≈0.5) makes all
plans comfortably positive. **Please give me `OPENROUTER_FEE_PCT` before phase 3.**

---

## 10. `verify-tiers` design (acceptance)

Uses a tiny live budget via the user's 3 keys (or a dedicated verification user):
- Enable `X-OpenRouter-Experimental-Metadata: enabled` to read routing decisions.
- **Tier 3:** request a model that has both ZDR and non-ZDR endpoints; assert the selected
  provider appears in `GET /api/v1/endpoints/zdr` for that model (and the request body carried
  `provider.zdr=true`).
- **Tier 2:** assert the routed endpoint is not marked training-enabled (guardrail) and the request
  carried `provider.data_collection="deny"`.
- **Tier 1:** assert a broad catalog is reachable (model count ≈ unfiltered).
- **Catalog match:** assert each key's `/models` list equals the guardrail/policy expectation.
Exits nonzero on any violation; spends a few cents.

---

## 11. Privacy hygiene audit (default: disable anything that undermines Tier 3)

| Feature | Where content can go | Config/env gate | Recommendation |
|---|---|---|---|
| Web search | Serper/Tavily/Firecrawl/Jina/Cohere/SearXNG (`packages/api/src/web/web.ts`, `handleTools.js:455-481`) | `webSearch.*`, provider keys, role `WEB_SEARCH` | **Disable** (omit config/keys; `filteredTools:[web_search]`; role off). Optional self-hosted SearXNG. |
| RAG / embeddings | `RAG_API_URL` service → `RAG_OPENAI_BASEURL` (could be another provider) | `RAG_API_URL`, `RAG_OPENAI_*`, `EMBEDDINGS_*` | **Disable** for MVP (unset `RAG_API_URL`); if enabled, point embeddings at OpenRouter and document. |
| STT / TTS | OpenAI/Azure/ElevenLabs (`STTService.js:211`, `TTSService.js:113,189`) | `speech.*`, `STT_API_KEY`, `TTS_API_KEY` | **Disable** (omit `speech`). |
| Image generation | OpenAI/DALL·E, Flux, SD, Gemini (`structured/*`) | provider keys, `filteredTools` | **Disable** (no keys; filter tools). |
| Code interpreter | operator Code API (`LIBRECHAT_CODE_BASEURL`) | env, `AgentCapabilities.execute_code`, role `RUN_CODE` | **Disable** for MVP. |
| MCP servers | arbitrary remote servers | `mcpServers`, `mcpSettings`, role `MCP_SERVERS` | **Disable** (no servers; role off). |
| Langfuse | Langfuse Cloud/self-host | `langfuse.*`, `LANGFUSE_*` | **Disable** (default off). |
| OpenTelemetry / RUM | OTLP collector / HyperDX | `OTEL_*`, `RUM_*` | **Disable** (default off). |
| Analytics/telemetry | none in source; Meili analytics off | `MEILI_NO_ANALYTICS=true`, `scarfSettings.enabled=false` | Already off; keep. |
| **Title generation** | same endpoint by default; can cross to `titleEndpoint` | `TITLE_CONVO`, `titleConvo/titleEndpoint/titleModel` | **Pin to same tier endpoint** (never set `titleEndpoint`); `titleConvo:true`, `titleModel` within tier. |
| Summarization / compaction | can target `summarization.provider/model` | `summarization.*` | **Disable cross-provider** or pin to same tier; self-summarization inherits the agent's applied params. |
| Memory agent | can target `memory.agent.provider/model` | `memory.*` | **Disable** for MVP. |
| Activity / reasoning labels | `activityEndpoint`/`reasoningLabelEndpoint` | endpoint/base fields | **Pin to same tier** or disable labels. |
| OCR / Mistral | `api.mistral.ai` | `ocr.*`, `MISTRAL_API_KEY` | **Disable** (omit `ocr`). |
| File storage | S3/Firebase/Azure | `fileStrategy`, `AWS_*`, etc. | **Local only** (default). |
| Agent Actions | third-party OpenAPI | `actions.allowedDomains`, `AgentCapabilities.actions` | **Disable** for MVP. |
| Jina/Cohere rerank | api.jina.ai | `webSearch.jina*/cohere*` | Disabled with web search. |

Enforcement of "disable" is done in `librechat.yaml` (omit sections), env (unset keys), role
permissions, and `filteredTools`. We will not log message bodies anywhere.

---

## 12. `.env.example` additions (names only)

```
OPENROUTER_MANAGEMENT_KEY=
SURVIEL_OPENROUTER_MGMT_KEY_EXPIRES_AT=
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
STRIPE_WEBHOOK_SECRET_LOCAL=
SURVIEL_STRIPE_WEBHOOK_SOURCE=cli|dashboard
STRIPE_PRICE_50_ID=
STRIPE_PRICE_100_ID=
STRIPE_PRICE_200_ID=
STRIPE_FEE_PCT=2.9
STRIPE_FEE_FIXED=0.30
OPENROUTER_FEE_PCT=
CREDIT_GRANT_RATIO=0.9
SURVIEL_RECONCILE_INTERVAL_MS=120000
SURVIEL_PRICING_TTL_MS=3600000
SURVIEL_LOW_BALANCE_USD=5
SURVIEL_GRACE_DAYS=3
SURVIEL_ALLOW_LIVE_STRIPE=false
```
(All non-secret levers also live in the `librechat.yaml` `surviel` block with defaults.)

---

## 13. Phases (one commit each, no push/deploy)

1. **Local dev + endpoints + tooling** — branch `mvp`; `librechat.yaml` 3 endpoints;
   `surviel` config schema; `check-env`, `stripe-local-secret`; Docker docs; route skeleton;
   `description` + `hideUserProvidedKey` plumbing. Verify all three endpoints appear and chat
   errors cleanly with no key.
2. **OpenRouter bootstrap + provisioning** — guardrails, org flag, key provision/deprovision,
   encrypted-store wiring, deletion hook, management-key expiry warnings.
3. **Stripe subscriptions + ledger** — Stripe client (test guard), checkout/portal, webhook
   (signature/idempotency/order), periods/grants, proration, lifecycle.
4. **Reconciler + credits API + pricing + UI** — periodic/on-demand sync, credits endpoint,
   pricing service (SWR), widget/prompt/breakdown/manage.
5. **Enforcement tests + privacy hardening + docs** — outbound body capture per path, override
   tests, `verify-tiers`, privacy config lockdown, `docs/surviel.md`, sanitizer/proxy if needed.

---

## 14. Questions for you (blocking)

1. **Repo/branch:** the workspace is upstream `danny-avila/LibreChat` @ `v0.8.8-rc4` on `main`,
   not `fdpitney2000/Surviel-Me-Not`. The nested `librechat2/` is an empty `fdpitney2000/librechat2`
   clone. Which is authoritative? Should I create `mvp` off this `main`, and add an `upstream`
   remote (canonical is already `origin`)?
2. **Secrets:** `OPENROUTER_MANAGEMENT_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` did not
   appear set in the workspace `.env`. Confirm you'll add them (or tell me the correct env file).
3. **OpenRouter fee:** what is `OPENROUTER_FEE_PCT` under your Enterprise terms? Needed for §9.
4. **Tier 2 hardening:** approve adding `enable_free_model_training=false`,
   `enable_paid_model_training=false`, `enable_free_model_publication=false` to Tier 2's guardrail
   in addition to `provider.data_collection="deny"`?
5. **Key prompt suppression:** approve the minimal `hideUserProvidedKey` endpoint field +
   `loadCustomEndpointsConfig` change?
6. **Overspend mode:** approve `allocate`-to-active-tier (default, bounds ~1×) or keep the literal
   spec formula (`duplicate`, bounds ~3×)? Both configurable.
7. **OpenRouter org:** confirm the management key belongs to an **organization** (personal keys get
   404 on `/organization/settings` and can't use `is_filtered_model_catalog_enabled`). Which
   workspace should guardrails live in?
8. **Model allowlists:** should guardrails restrict `allowed_models` per tier, or rely solely on the
   filtered catalog + request params? (I lean filtered catalog only for MVP.)
9. **Per-message cost:** confirmed OpenRouter always returns `usage.cost`; OK to surface it in chat?
10. **Docker:** use upstream `docker-compose.yml` or the untracked `docker-compose.librechat2.yml`
    (`librechat2-local`, PORT=3081)? Should Stripe CLI forwarding stay manual (not in compose)?
11. **Stripe portal:** confirm you'll configure the Customer Portal manually (upgrade/downgrade/
    cancel, plans, "unused credits expire" copy at checkout). I'll give exact steps in phase 3.
12. **Live-key guard:** confirm the app should refuse to start with live Stripe keys unless
    `SURVIEL_ALLOW_LIVE_STRIPE=true`.

I will not write any code until you answer/approve.
