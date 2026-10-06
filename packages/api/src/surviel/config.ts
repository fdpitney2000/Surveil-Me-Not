import { survielConfigSchema } from 'librechat-data-provider';
import type { TSurvielConfig, TSurvielTier } from 'librechat-data-provider';

/** Canonical guardrail names, one per tier, created idempotently by the bootstrap script. */
export const GUARDRAIL_NAMES: Record<number, string> = {
  1: 'surviel:tier1',
  2: 'surviel:tier2',
  3: 'surviel:tier3',
};

export interface ResolvedSurvielConfig extends TSurvielConfig {
  tiers: TSurvielTier[];
}

function envNumber(key: string): number | undefined {
  const raw = process.env[key];
  if (raw == null || raw.trim() === '') return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

function envBoolean(key: string): boolean | undefined {
  const raw = process.env[key];
  if (raw == null || raw.trim() === '') return undefined;
  return ['1', 'true', 'yes', 'on'].includes(raw.trim().toLowerCase());
}

/**
 * Resolve the effective Surviel config from the parsed `librechat.yaml` block, overlaying
 * explicit environment overrides. Defaults come from the schema so a stock deployment is
 * untouched. Never reads secrets.
 */
export function resolveSurvielConfig(raw?: Partial<TSurvielConfig>): ResolvedSurvielConfig {
  const base = survielConfigSchema.parse(raw ?? {});

  const overrides: Partial<ResolvedSurvielConfig> = {};
  const enabled = envBoolean('SURVIEL_ENABLED');
  if (enabled !== undefined) overrides.enabled = enabled;

  const reconcileIntervalMs = envNumber('SURVIEL_RECONCILE_INTERVAL_MS');
  if (reconcileIntervalMs !== undefined) overrides.reconcileIntervalMs = reconcileIntervalMs;

  const pricingTtlMs = envNumber('SURVIEL_PRICING_TTL_MS');
  if (pricingTtlMs !== undefined) overrides.pricingTtlMs = pricingTtlMs;

  const lowBalance = envNumber('SURVIEL_LOW_BALANCE_USD');
  if (lowBalance !== undefined) overrides.lowBalanceThresholdUsd = lowBalance;

  const graceDays = envNumber('SURVIEL_GRACE_DAYS');
  if (graceDays !== undefined) overrides.graceDays = graceDays;

  const grantRatio = envNumber('CREDIT_GRANT_RATIO');
  if (grantRatio !== undefined) overrides.creditGrantRatio = grantRatio;

  return { ...base, ...overrides, tiers: base.tiers };
}

/** The custom endpoint name for a tier, or undefined when the tier is not configured. */
export function endpointForTier(config: ResolvedSurvielConfig, tier: number): string | undefined {
  return config.tiers.find((entry) => entry.tier === tier)?.endpoint;
}

/** The tier number for a custom endpoint name, or undefined when it is not a Surviel tier. */
export function tierForEndpoint(
  config: ResolvedSurvielConfig,
  endpoint: string,
): number | undefined {
  return config.tiers.find((entry) => entry.endpoint === endpoint)?.tier;
}

/** The OpenRouter key name for a user and tier. Not a secret. */
export function openRouterKeyName(userId: string, tier: number): string {
  return `surviel:${userId}:${tier}`;
}

/** The prefix used to find all of a user's keys. */
export function openRouterKeyPrefix(userId: string): string {
  return `surviel:${userId}:`;
}
