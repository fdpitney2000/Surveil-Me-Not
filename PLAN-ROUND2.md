# Surviel-Me-Not — Round 2 Plan (model selector, branding, Stripe visibility)

Round 1 (`PLAN.md`) is implemented. This plan covers the four known defects/improvements
from testing round 1. **Approved 2026-11-02 with user revisions; implementation in
progress.**

## 1. Findings (verified in code, 2026-11-02)

### F1 — Root cause candidate for "Stripe options do not appear" AND missing tiers in production
- `.dockerignore:12` excludes `librechat*` from the image, and `deploy-surveil.yml`
  (lines 47–55) does **not** bind-mount `./librechat.yaml`. The local
  `docker-compose.override.yml:30` does, but that file is only auto-applied with plain
  `docker compose up` — never with `-f deploy-surveil.yml`.
- Consequence: any container started with `deploy-surveil.yml` (local prod-mode build **and
  the VPS**) runs with no `librechat.yaml` → no three tier endpoints, and
  `resolveSurvielConfig(appConfig?.surviel)` in `api/server/routes/config.js:276` gets
  nothing → `startupConfig.surviel.enabled = false` → `CreditsWidget.tsx:89,101` returns
  `null` → the plan picker (Stripe checkout entry point) is never rendered.
- This single missing mount plausibly explains both "payment options do not appear" and,
  on any deploy-surveil-built environment, the absence of tier endpoints.

### F2 — Why the model menu lists providers next to the tiers
- `getEnabledEndpoints()` (`packages/data-provider/src/parsers.ts:78-99`) defaults to
  `openAI, agents, assistants, azureAssistants, azureOpenAI, google, anthropic, bedrock`
  when the `ENDPOINTS` env var is unset. `orderEndpointsConfig` keeps every custom
  endpoint regardless. So the selector shows all built-in providers plus our three custom
  tier endpoints.
- Setting `ENDPOINTS=custom` on the server removes all built-in providers from
  `/api/endpoints`; custom (tier) endpoints still appear. Side effect: the Agents
  endpoint disappears too — see Q1.

### F3 — Why only `openai/gpt-4o-mini` appears under each tier
- `createLoadConfigModels` (`packages/api/src/endpoints/config/models.ts:236-286`): with
  `apiKey: 'user_provided'` + `models.fetch: true`, the fetch needs the user's provisioned
  key from the encrypted store. When no key exists (`NO_USER_KEY`), the endpoint falls
  through to `models.default` — which is `[openai/gpt-4o-mini]` in `librechat.yaml`.
- So the single-model symptom means **no provisioned key was found** — consistent with F1
  (checkout unreachable → no subscription → no keys) and/or provisioning never running.
- Secondary defect: even without a key, the picker *shows* gpt-4o-mini (send then fails at
  initialize). Pre-subscription users should see an empty picker + pricing prompt, not a
  selectable model.
- With keys provisioned, the fetch hits OpenRouter `/api/v1/models` with the user's tier
  key. Bootstrap already enables `is_filtered_model_catalog_enabled`, so each key's list
  should reflect its guardrail. **Not yet verified live** — verify-tiers covers routing,
  not the picker list.

### F4 — Branding state
- Landing: standalone `client/public/home.html` (1229 lines, inline CSS, own palette
  `#0d0d0d`/`#10b981`), served to anonymous visitors at `/` by
  `packages/api/src/surviel/landing.ts`; `deploy-home.sh` ships it alone.
- Chat app: stock LibreChat theme. Branding levers that already exist, no fork needed:
  `interface.theme` (bundled name or **inline theme definition**, light/dark —
  `packages/data-provider/src/config.ts:2593-2658`), `APP_TITLE`, `interface.customWelcome`,
  `CUSTOM_FOOTER`, plus logo/favicon assets under `client/public/assets`.
- `getAppConfig` is already tenant-aware (`getAppConfigOptionsFromUser`), so per-brand
  resolution later is an extension, not a rewrite.

## 2. Decisions (approved 2026-11-02, with user revisions)

- **D1 (approved)** Add the missing `./librechat.yaml:/app/librechat.yaml:ro` mount to
  `deploy-surveil.yml` so local prod-mode builds and the VPS load tier endpoints +
  Stripe features identically.
- **D2 (revised by user)** Keep the tier selector as the only endpoint menu
  (`ENDPOINTS=custom`). Within each tier, **free users can browse and use free models**;
  paid models stay visible in the list (not hidden) but locked/grayed and sorted lower
  until the user has an active subscription.
- **D3 (revised by user)** Provision **real per-user OpenRouter keys at registration**
  (not only on payment): 3 tier keys with spend limit 0, so free (`:free`) models work
  immediately and the model fetch returns the real catalog. On first successful payment
  the reconciler raises limits per the existing period model. Remove the
  `models.default` gpt-4o-mini fallback (empty list only if provisioning genuinely
  failed) and switch `titleModel` to a free model so title generation works for free
  users. Key deletion on account deletion already exists.
- **D4** Tier-filtered pickers: rely on OpenRouter's filtered catalog (already enabled at
  bootstrap) as the source of truth for Tier 1/3 lists. For Tier 2, check whether the
  filtered catalog reflects `data_collection` — if not, evaluate a server-side filter in
  `loadConfigModels` using OpenRouter endpoint data-policy fields; if the API exposes
  nothing usable, show the full list and surface routing errors clearly (spec-sanctioned
  fallback). Decision after a live check in Phase 2.
- **D5 (approved)** Branding: keep `home.html` as the landing page. Brand the chat via
  inline `interface.theme` matching its palette, `APP_TITLE`, `customWelcome`,
  `CUSTOM_FOOTER`, logo/favicon. Single token source + drift check; per-domain
  white-label deferred.
- **D6** Stripe: after D1, run the documented test-card flow end-to-end and fix what
  actually breaks; produce the manual Stripe-dashboard checklist (portal config, webhook
  endpoint for production, test clock setup).
- **D7 (new, from user)** Free/paid model lock UX: the picker gets pricing + subscription
  state (`/api/surviel/pricing` + `/api/surviel/credits` already exist). Free models
  (zero price) enabled for all; paid models listed below, locked with an upgrade
  affordance until `credits.status` is active. Server-side enforcement remains the
  OpenRouter key limit (0 for free users) — paid requests fail closed even if the UI is
  bypassed.

## 3. Phases (one commit each, no push/deploy)

### Phase 0 — Reproduce & confirm root causes (no code changes)
1. Start Docker; build with the exact prod path:
   `docker compose -p surveil -f deploy-surveil.yml up -d --build`.
2. `docker exec surveil-api ls /app/librechat.yaml` → expect missing (confirms F1).
3. `curl localhost:3080/api/config` (authenticated) → expect `surviel.enabled` absent/false.
4. Rebuild with mount added locally via a temporary `-f` override → confirm tiers appear,
   widget appears, plan picker renders.
5. Record which reported symptoms survive → feeds Phases 2–4.

### Phase 1 — Config fixes (D1, D2, D3 config half)
- `deploy-surveil.yml`: add librechat.yaml mount.
- `.env.example`: add `ENDPOINTS=custom` with a comment.
- `librechat.yaml`: remove `models.default` fallback; switch `titleModel` to a free model.
- Docs: update `docs/surviel.md` runbook (build command + ENDPOINTS note).
- Verify: menu shows exactly three tiers; login/landing unaffected.

### Phase 2 — Registration provisioning + free/paid picker (D3 code, D4, D7)
- Registration hook: provision 3 keys (limit 0) idempotently on signup; reuse
  `provision.ts`; keep payment-time provisioning as the limit-raiser.
- Verify: webhook → period started → keys' limits raised → `/api/models` per tier returns
  the guardrail-filtered catalog (Tier 3 ZDR-only, Tier 1 full).
- Decide Tier 2 picker filtering per D4 from live API evidence.
- Picker UI: free-first sort, paid models locked + upgrade affordance until subscription
  active; data from `/api/surviel/pricing` + `/api/surviel/credits`.
- Stripe dashboard manual-steps checklist → appended to `docs/surviel.md`.

### Phase 3 — Chat branding (D5)
- Inline `interface.theme` in `librechat.yaml` matching home.html tokens; `APP_TITLE`,
  `customWelcome`, `CUSTOM_FOOTER` in `.env.example`.
- Logo/favicon: export the home.html shield mark to `client/public/images`/assets and wire
  per LibreChat conventions (verify which asset paths the build serves).
- Brand-token single source: script/test asserting home.html palette == theme tokens.
- Verify: light/dark, login page, chat, sidebar widget all carry the brand; e2e
  `e2e/home.test.mjs` still passes.

### Phase 4 — Hardening & regression pass
- `npx tsc --noEmit` in touched workspaces; focused Jest for changed modules; `npm run
  surviel:verify-tiers -- <userId>`; test-clock renewal smoke if Stripe was touched.
- Update `PLAN-ROUND2.md` checkboxes → merge notes into `PLAN.md` after approval.

## 4. Files likely to change
- `deploy-surveil.yml` (mount), `.env.example` (ENDPOINTS, APP_TITLE, CUSTOM_FOOTER),
  `librechat.yaml` (models defaults, titleModel, theme, welcome), `docs/surviel.md`
  (runbook + Stripe checklist), `client/public/home.html` (token sync only if needed),
  registration/provisioning code in `packages/api/src/surviel/` + auth hook, model-picker
  components in `client/src`, new `scripts/surviel/brand-check.mjs` + test.

## 5. Risks
- **ENDPOINTS=custom** removes Agents/assistants UI — acceptable for MVP? (Q1)
- Removing `models.default` means OpenRouter outage = empty picker. Mitigation: the fetch
  layer already caches; pricing service has stale-while-revalidate; document the behavior.
- Filtered-catalog behavior for Tier 2 is unverified; worst case we ship full catalog +
  clear routing errors (spec allows).
- Inline theme definitions are validated by `collectThemeIssues`; unknown token coverage —
  Phase 3 starts with a token audit against home.html's palette.
- deploy-home.sh hardcodes the VPS IP; unrelated but noted for later.

## 6. Questions — resolved 2026-11-02
- Q1 Agents endpoint: removed along with other providers (tier-only menu) — accepted.
- Q2 Symptom location: VPS — matches F1.
- Q3 Free/paid: free users browse/use free models; paid locked until subscribed (D2/D7).
- Q4 White-label: single-brand token layer now; per-domain later (D5).
- Q5 Unsubscribed users: allowed in chat UI on free models (D3/D7).

## 5b. Additional risk (from D3/D7)
- Free-key limit 0 behavior on OpenRouter (`:free` models allowed at limit 0) must be
  verified live in Phase 2; if OpenRouter rejects all requests at limit 0, fall back to a
  tiny nonzero limit (e.g. $0.10) or a per-user free allowance.
