/** Shared client-side defaults for Surveil privacy-tier model selection. */

export const PREFERRED_FREE_MODELS = [
  'inclusionai/ling-3.2-flash:free',
  'google/gemma-4-31b-it:free',
];

const FALLBACK_SURVEIL_TIERS = new Set([
  'Max Model Selection',
  'Commercial Privacy',
  'Enterprise Vault',
]);

export function isSurveilTierEndpoint(
  endpoint: string | null | undefined,
  tiers?: Array<{ endpoint: string }>,
): boolean {
  if (tiers?.length) {
    return tiers.some((tier) => tier.endpoint === endpoint);
  }
  return FALLBACK_SURVEIL_TIERS.has(String(endpoint));
}

export function getPreferredFreeModel(models: string[]): string | undefined {
  return (
    PREFERRED_FREE_MODELS.find((model) => models.includes(model)) ??
    models.find((model) => model.endsWith(':free'))
  );
}
