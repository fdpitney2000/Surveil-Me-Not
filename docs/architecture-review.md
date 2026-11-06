# Surveil-Me-Not — Architecture Review

Status: **review only. No code.** Date: 2026-11-05.

This reviews the project at a system level, not the beta feature list. It answers three
questions: whether to keep the fork, whether the branding direction scales to white-label and
wholesale, and whether the current stack/approach is still the right one. It also adopts the
single-key model you proposed.

---

## 0. Bottom line

1. **Keep the fork. Do not start a new repo.** The custom diff is 120 files and +8,883/−49
   against `upstream/main`; it is additive and isolated. A new fork would re-apply the same 120
   files, lose history/CI, and not reduce the integration work.
2. **Create `staging` from `mvp`.** There is no `staging` branch yet. Keep `main` as an upstream
   mirror, `staging` as beta, and `mvp` as an archive tag. Merge `upstream/main` into `staging`
   monthly.
3. **Adopt one OpenRouter key per customer.** Key `limit` = net; key `expires_at` = exact next
   anniversary; tier privacy is request-level (three endpoints, each with its own `addParams`).
   Drop per-tier keys, per-user workspaces, and workspace budgets. This is simpler and removes
   the workspace-limit/guardrail-scoping questions entirely.
4. **Introduce a tenant descriptor now, even with one tenant.** Branding, auth, billing, email,
   support, and data isolation become per-tenant config instead of hardcoded strings. That is the
   forward-compatible path to white-label and wholesale.
5. **Plan a thin `surveil-gateway` boundary.** Keep LibreChat as the UI/auth/conversation shell;
   move key custody, tier policy, budgets, billing, and privacy receipts into an
   OpenAI-compatible gateway. Beta can keep the logic in the fork, but the boundary should be
   designed now and extracted at v1/wholesale.

---

## 1. Question 1 — pivot from `mvp` to `staging`, or a new fork from LibreChat?

### Evidence

| Measure | Result |
| --- | --- |
| Custom diff vs `upstream/main` | 120 files, **+8,883 / −49** |
| Custom Surveil code | ~4,480 lines under `packages/api/src/surveil`, `client/src/components/Surveil`, `scripts/surveil` |
| Modified upstream files | ~40 integration points (`UserController`, `AuthService`, routes, config, model selector, sidebar, assets) |
| Branches | `main`, `mvp` only; **no `staging` branch** |
| Upstream remote | `LibreChat-AI/LibreChat`, merge-base `e1dfc104` |

### Analysis

- The fork is **additive**, not a rewrite: almost no upstream deletions. That is the healthiest
  possible fork shape.
- The upgrade tax is the ~40 modified upstream files, not the 8.8k inserted lines. Those edits
  are concentrated in auth, user deletion, config, model picker, sidebar, and assets.
- A new fork would not remove that tax; it would reproduce it. It would also lose commit history,
  CI configuration, and the deployed VPS state. There is no architectural gain.
- The real long-term fix is to **shrink the fork's surface**: move key custody, budgets, tier
  policy, and billing into a gateway; leave the fork with UI hooks, auth, and deployment config.

### Recommendation

- Keep the fork. Create `staging` from `mvp`:
  ```bash
  git switch mvp
  git switch -c staging
  git push -u origin staging
  ```
- Branch model:
  - `main` — upstream mirror; never commit product code here.
  - `staging` — beta; feature branches from here; one commit per phase.
  - `mvp` — archive/tag of the first iteration.
  - Monthly: `git fetch upstream && git merge upstream/main` into `staging`, resolve conflicts,
    run focused tests.
- Keep custom code in isolated modules. Avoid new edits to upstream files; prefer hooks,
  adapters, and new files. Every upstream edit is a future merge conflict.
- A new fork only makes sense if you deliberately want a **thin patch set** around a gateway.
  Even then, port the existing modules; do not start from zero.

---

## 2. Question 2 — does the branding direction scale to white-label and wholesale?

### Current state

- Landing: one self-contained `client/public/home.html` (1,229 lines) with hardcoded brand
  strings, palette, and SVG marks; served to anonymous visitors.
- Chat: global `interface.theme` in `librechat.yaml`, `APP_TITLE`, `customWelcome`,
  `CUSTOM_FOOTER`; single brand.
- LibreChat already has useful multi-tenant seams:
  - `preAuthTenant` middleware reads `X-Tenant-Id` (when `TRUST_TENANT_HEADER=true`).
  - `getAppConfigOptionsFromUser(user, tenantId)` resolves config per user/tenant.
  - `tenantId` is supported in config, auth, Langfuse, skills, and storage paths.
  - Social logins include `openid` and `saml`; OIDC/SAML is available for wholesale identity.

### What scales and what does not

| Need | White-label | Wholesale |
| --- | --- | --- |
| Operator | Surveil runs the platform | Another party runs the platform |
| Branding | Per-brand name/logo/colors/domain | Entirely the party's brand |
| Auth | Surveil auth (or per-brand SSO) | Party's IdP (OIDC/SAML) |
| Billing | Surveil Stripe (or Stripe Connect) | Party's Stripe |
| Support | Surveil support, branded | Party's support |
| Data | Shared platform, tenant-scoped | Separate DB/storage per party (recommended) |
| Deployment | One deployment, many domains | One deployment per party, or a control plane |

The current single `home.html` + global theme is a **single-tenant shortcut**. It is fine for
beta, but it will not support multiple brands or wholesale without a tenant layer. The good news
is LibreChat's tenant seams already exist; you do not need a new framework.

### Recommendation: a tenant descriptor now

Define a tenant model, even if only `surveil` exists at beta:

```ts
interface Tenant {
  id: string;                 // stable tenant id
  slug: string;               // "surveil", "acme"
  domains: string[];          // custom hostnames
  brand: {
    name: string;
    logo: string;             // asset path or inline SVG
    favicon: string;
    colors: Record<string, string>;
    theme: 'light' | 'dark' | 'system';
    welcome: string;
    footer: string;
    supportEmail: string;
    legalLinks: { terms: string; privacy: string; dpa?: string };
  };
  auth: { mode: 'local' | 'oidc' | 'saml'; config?: Record<string, unknown> };
  billing: { mode: 'stripe' | 'stripe_connect' | 'none'; accountRef?: string; prices?: Record<string, string> };
  email: { mode: 'loops' | 'smtp'; fromDomain: string; templates?: Record<string, string> };
  openrouter: { mode: 'managed' | 'byok' | 'shared_free'; keyPrefix: string };
  data: { mongoRef: string; storageRegion?: string; isolation: 'shared' | 'dedicated' };
  features: { tiers: boolean; topups: boolean; freeTier: boolean; byok: boolean };
}
```

How it resolves:

- **Host → tenant**: the reverse proxy (Caddy) maps the hostname to `X-Tenant-Id`;
  `TRUST_TENANT_HEADER=true`; `preAuthTenant` runs the request in tenant context.
- **Landing**: `home.html` becomes a template with `{{brand.*}}` placeholders and CSS variables.
  A server-side renderer selects the tenant by host and caches per tenant. Keep the single file
  for rapid iteration; do not fork it per client.
- **Chat**: per-tenant `getAppConfig` returns `interface.theme`, `APP_TITLE`, `customWelcome`,
  `CUSTOM_FOOTER`, logo/favicon. The global `librechat.yaml` theme becomes the default tenant's
  config, not the only theme.
- **Email**: per-tenant Loops/SMTP and from-domain. For white-label, the Surveil domain can
  remain the sender with the brand in the display name; for wholesale, the party's domain.
- **Billing**: define a `BillingProvider` interface (`stripe`, `stripe_connect`, `none`). White-label
  can use one Stripe account with brand metadata or Stripe Connect; wholesale uses the party's
  Stripe account. Do not hardcode Stripe in the gateway or the UI.
- **Auth**: `local`, `oidc`, `saml`; per-tenant config. For wholesale, the party's IdP.
- **Data**: `tenantId` on new collections; for white-label, shared DB with tenant scoping; for
  wholesale, **dedicated Mongo/storage per tenant** (strong isolation, simpler compliance).
- **Domains/SSL**: Caddy on-demand TLS or Cloudflare; per-tenant domain verification; a tenant
  map in Caddy. The current `caddy reverse-proxy --from ${DOMAIN}` is single-domain; a Caddyfile
  with `@tenant` matchers is the multi-domain path.
- **Commerce/support disclosure**: white-label keeps "Billing and support by Surveil Me Not" in
  the footer/checkout; wholesale removes it (the party owns commerce/support).

### What to do for beta

- Implement the tenant descriptor with one tenant (`surveil`) and the `brands/surveil.json`
  file. Render `home.html` from it; wire `interface.theme`/title/welcome/footer from it.
- Add `tenantId` to new collections (subscriptions, keys, top-ups, audit events). Do not
  backfill existing data yet.
- Keep the per-host resolver and multi-tenant data isolation as **interfaces**, not full
  implementations. That is enough forward compatibility for white-label.
- For wholesale, plan **per-tenant deployment** first (same code, separate env/DB/Stripe/IdP).
  A single multi-tenant deployment is a later optimization for white-label only.

---

## 3. Question 3 — is the current stack/approach still the best?

### What the product actually is

The differentiator is **privacy policy enforcement plus billing/tenant control**, not the chat
UI. LibreChat is a commodity chat/auth/conversation shell; the value is the layer that decides
which provider may see a request, proves it, and bills for it. That layer should be as
independent of LibreChat as possible.

### Single key per customer (adopt this)

Your proposed simplification is correct:

- One OpenRouter key per customer: `surveil:{userId}`.
- `limit` = net proceeds for the period.
- `expires_at` = exact next anniversary.
- Three tier endpoints share the key; each endpoint's server-side `addParams` injects the tier
  policy (`provider.zdr`, `provider.data_collection`).
- No per-tier keys, no per-user workspace, no workspace budget, no per-key limit reconciler.
- Renewal: create a new key with the next `expires_at` and `limit = net`; delete the old key
  after a short grace. Top-ups raise the current key's `limit`.
- Free tier: one shared `surveil:free` key, `limit: 0`, free models only.
- BYOK: one user key, same endpoints; no Surveil budget.

Trade-offs to state honestly:

- **Lost key-level tier guardrails.** A key can hold only one guardrail, and one guardrail cannot
  express three tiers. With one key, the tier policy is enforced by the request path, not by the
  key. If the key leaks, a caller could call OpenRouter without the tier params. Mitigations: the
  key is server-side only, encrypted at rest, never sent to the client; rotate on suspicion;
  monitor usage; the key limit caps financial loss. If you need key-level enforcement later, go
  back to three keys, not one.
- **Lost per-tier usage.** One key's `usage` is total. If per-tier reporting matters, log the
  endpoint/tier per request at the app layer (no content) or keep three keys. For beta, total
  usage plus a per-tier request count is enough.
- **The privacy claim becomes a request-path claim.** That is still strong if the server is the
  only caller and the params are injected after user input is stripped. Add a `verify-tiers` audit
  and a per-request privacy receipt (routing metadata, not content) to make it visible.

This removes the workspace-limit, guardrail-scoping, and three-key accounting questions from the
beta plan. It is the right simplification.

### The gateway boundary (plan now, extract at v1)

A standalone **`surveil-gateway`** is an OpenAI-compatible proxy between LibreChat and OpenRouter:

- holds the OpenRouter key (or the user's BYOK key) server-side;
- selects the tier policy from the endpoint/model or a signed header;
- injects `provider` params after stripping user-supplied params;
- records usage and enforces the key budget;
- streams SSE, handles cancellation and tool calls;
- emits a privacy receipt (model, provider, ZDR/data-collection flags, no content);
- resolves tenant config for keys, billing, and branding.

LibreChat's custom endpoint `baseURL` points at the gateway, and its per-user "API key" is a
Surveil gateway token, not an OpenRouter key. The gateway maps the token to the customer's key.
This is the clean seam that makes wholesale possible: a party can run the gateway with its own
Stripe/auth/support, or Surveil can run one gateway per tenant.

For beta, keep the logic in `packages/api/src/surveil` but design it as a gateway-ready module:
- no LibreChat imports in the policy/key/budget logic;
- a `PolicyEngine` that takes `{ tier, request }` and returns the provider block;
- a `KeyStore` interface (OpenRouter managed key, BYOK, shared free);
- a `Budget` interface (key limit, top-up);
- a `PrivacyReceipt` record (metadata only).

Extract to a separate service when you add wholesale or when the fork's upgrade tax becomes
painful. Do not extract just for beta; the extra hop and streaming complexity are not worth it
yet.

### Stack alternatives

| Option | Verdict |
| --- | --- |
| LibreChat + thin gateway | **Best fit.** Mature UI/auth/conversations; gateway owns the differentiator; fork stays small. |
| Open WebUI | Simpler Python UI, weaker enterprise auth/tenant/billing; would need the same gateway and more custom work. |
| Custom Next.js chat | Maximum control, much more work; not justified for beta. |
| LiteLLM Proxy + a UI | LiteLLM is a good gateway but not a tenant/billing/privacy-receipt product; you would still build the UI and tenant layer. |
| Pure API / no chat UI | Wrong product for this audience. |

LibreChat + a thin gateway is the right long-term shape. The current fork is acceptable for
beta; the gateway is the v1/wholesale move.

### Other stack notes

- **Data**: Mongo + Redis + Docker + Caddy is fine. Add `tenantId` to new collections; for
  wholesale, dedicated DB/storage per tenant. Encrypt backups; test restore.
- **Auth**: LibreChat local/OIDC/SAML is sufficient. For wholesale, per-tenant IdP; do not build
  a custom auth system.
- **Billing**: Stripe direct for Surveil; Stripe Connect or per-tenant Stripe for wholesale.
  Wrap it in `BillingProvider`; keep invoice/webhook logic out of the UI.
- **Email**: Loops for Surveil; per-tenant Loops/SMTP for wholesale. `EmailProvider` interface.
- **OpenRouter**: single gateway is correct for privacy. Use request-level params; keep a
  baseline guardrail only if you want an org-level backstop.
- **Observability**: structured logs with redaction; a privacy receipt table (metadata only);
  alert on key provisioning, webhook failures, budget exhaustion, and management-key expiry.
  Do not send prompts/completions to third-party observability.

---

## 4. Migration path

| Phase | Scope | Fork impact |
| --- | --- | --- |
| Beta (now) | One key per customer; key limit/expiry; three tier endpoints; tenant descriptor with one tenant; free shared key; top-ups; Loops auth | Small: key model + tenant config + UI hooks |
| v1 | Extract `surveil-gateway`; LibreChat points custom endpoints at it; privacy receipts | Shrinks the fork to UI/auth/config |
| White-label | Multiple tenants in one deployment; per-host branding; shared DB with tenantId | Tenant resolver + branding; no new fork |
| Wholesale | Per-tenant deployments (recommended) or a control plane; party-owned Stripe/auth/support | Deployment/control-plane work; same code |

---

## 5. Risks

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Fork drift from upstream | Merge pain, security lag | Keep custom edits isolated; monthly upstream merge; move logic to gateway |
| Key leak bypasses tier params | Privacy claim weakens | Server-side key only, encrypted, rotate, monitor; gateway boundary; document threat model |
| Per-tier usage lost with one key | Weaker reporting | App-layer tier logging (no content) or accept total-only for beta |
| Tenant isolation incomplete | White-label/wholesale compliance risk | `tenantId` now; dedicated DB for wholesale; audit queries |
| Gateway streaming complexity | Latency/bugs | Extract after beta; contract tests; SSE/cancel tests |
| Branding hardcoded | White-label rework | Tenant descriptor + template renderer now |
| Stripe/OpenRouter API changes | Breakage | Pin versions; contract tests; webhook idempotency |

---

## 6. Open questions

1. Do you want the **single-key** model as the beta default, accepting request-level tier
   enforcement and total-only usage? (Recommended.)
2. For per-tier reporting, is app-layer tier logging enough, or do you need to keep three keys?
3. Tenant descriptor: store in Mongo, YAML, or env? (Recommend Mongo for runtime changes, with
   a YAML bootstrap for the default tenant.)
4. White-label billing: one Stripe account with brand metadata, or Stripe Connect per brand?
5. Wholesale: per-tenant deployment first, or a multi-tenant control plane?
6. Gateway extraction: at v1, or only when wholesale starts?
7. `staging` branch: create from `mvp` now? (Recommended.)
