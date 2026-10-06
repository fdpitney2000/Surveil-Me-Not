import type { OpenRouterClient, OpenRouterGuardrail } from './client';
import type { ResolvedSurvielConfig } from '../config';
import { SurvielError, SurvielErrorCodes } from '../errors';
import { GUARDRAIL_NAMES } from '../config';

/** The five per-model-group ZDR flags (the legacy `enforce_zdr` is deprecated). */
export const ZDR_FIELDS = [
  'enforce_zdr_anthropic',
  'enforce_zdr_openai',
  'enforce_zdr_google',
  'enforce_zdr_xai',
  'enforce_zdr_other',
] as const;

/** The desired guardrail body for a tier. Tier 3 additionally enforces ZDR on all groups. */
export function guardrailSpec(
  tier: number,
  config: ResolvedSurvielConfig,
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    name: GUARDRAIL_NAMES[tier],
    limit_usd: config.guardrailBackstopUsd,
    reset_interval: 'monthly',
  };
  if (tier === 3) {
    for (const field of ZDR_FIELDS) body[field] = true;
  }
  return body;
}

function guardrailNeedsUpdate(
  existing: OpenRouterGuardrail,
  spec: Record<string, unknown>,
): boolean {
  if (existing.limit_usd !== spec.limit_usd) return true;
  if (existing.reset_interval !== spec.reset_interval) return true;
  for (const field of ZDR_FIELDS) {
    if ((spec[field] as boolean | undefined) === true && existing[field] !== true) return true;
  }
  return false;
}

/**
 * Create or converge the three tier guardrails and return them keyed by tier. Idempotent:
 * guardrails are matched by name, so repeated runs do not duplicate them.
 */
export async function resolveGuardrails(options: {
  client: OpenRouterClient;
  config: ResolvedSurvielConfig;
}): Promise<Record<number, OpenRouterGuardrail>> {
  const { client, config } = options;
  const existing = await client.listGuardrails();
  const byName = new Map(existing.map((guardrail) => [guardrail.name, guardrail]));
  const resolved: Record<number, OpenRouterGuardrail> = {};

  for (const tier of [1, 2, 3]) {
    const spec = guardrailSpec(tier, config);
    let guardrail = byName.get(GUARDRAIL_NAMES[tier]);
    if (!guardrail) {
      guardrail = await client.createGuardrail(spec);
    } else if (guardrailNeedsUpdate(guardrail, spec)) {
      guardrail = await client.updateGuardrail(guardrail.id, spec);
    }
    resolved[tier] = guardrail;
  }

  return resolved;
}

/**
 * Enable the organization's filtered model catalog so each API key's model list reflects
 * its guardrail. No-op when already enabled.
 */
export async function enableFilteredModelCatalog(options: {
  client: OpenRouterClient;
}): Promise<{ changed: boolean }> {
  const settings = await options.client.getOrganizationSettings();
  if (settings.is_filtered_model_catalog_enabled === true) {
    return { changed: false };
  }
  await options.client.updateOrganizationSettings({ is_filtered_model_catalog_enabled: true });
  return { changed: true };
}

/** Resolve guardrails by name without creating them; throws if any tier is missing. */
export async function requireGuardrails(options: {
  client: OpenRouterClient;
}): Promise<Record<number, OpenRouterGuardrail>> {
  const existing = await options.client.listGuardrails();
  const byName = new Map(existing.map((guardrail) => [guardrail.name, guardrail]));
  const resolved: Record<number, OpenRouterGuardrail> = {};
  for (const tier of [1, 2, 3]) {
    const guardrail = byName.get(GUARDRAIL_NAMES[tier]);
    if (!guardrail) {
      throw new SurvielError(
        SurvielErrorCodes.GUARDRAIL_MISSING,
        `Guardrail ${GUARDRAIL_NAMES[tier]} is missing. Run \`npm run surviel:openrouter-bootstrap\`.`,
        500,
      );
    }
    resolved[tier] = guardrail;
  }
  return resolved;
}
