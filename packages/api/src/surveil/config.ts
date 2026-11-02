import { surveilConfigSchema } from 'librechat-data-provider';
import type { TSurveilConfig, TSurveilTier } from 'librechat-data-provider';

/** Canonical guardrail names, one per tier, created idempotently by the bootstrap script. */
export const GUARDRAIL_NAMES: Record<number, string> = {
  1: 'surveil:tier1',
  2: 'surveil:tier2',
  3: 'surveil:tier3',
};

export interface ResolvedSurveilConfig extends TSurveilConfig {
  tiers: TSurveilTier[];
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
 * Resolve the effective Surveil config from the parsed `librechat.yaml` block, overlaying
 * explicit environment overrides. Defaults come from the schema so a stock deployment is
 * untouched. Never reads secrets.
 */
export function resolveSurveilConfig(raw?: Partial<TSurveilConfig>): ResolvedSurveilConfig {
  const base = surveilConfigSchema.parse(raw ?? {});

  const overrides: Partial<ResolvedSurveilConfig> = {};
  const enabled = envBoolean('SURVEIL_ENABLED');
  if (enabled !== undefined) overrides.enabled = enabled;

  const reconcileIntervalMs = envNumber('SURVEIL_RECONCILE_INTERVAL_MS');
  if (reconcileIntervalMs !== undefined) overrides.reconcileIntervalMs = reconcileIntervalMs;

  const pricingTtlMs = envNumber('SURVEIL_PRICING_TTL_MS');
  if (pricingTtlMs !== undefined) overrides.pricingTtlMs = pricingTtlMs;

  const lowBalance = envNumber('SURVEIL_LOW_BALANCE_USD');
  if (lowBalance !== undefined) overrides.lowBalanceThresholdUsd = lowBalance;

  const graceDays = envNumber('SURVEIL_GRACE_DAYS');
  if (graceDays !== undefined) overrides.graceDays = graceDays;

  const grantRatio = envNumber('CREDIT_GRANT_RATIO');
  if (grantRatio !== undefined) overrides.creditGrantRatio = grantRatio;

  return { ...base, ...overrides, tiers: base.tiers };
}

/** The custom endpoint name for a tier, or undefined when the tier is not configured. */
export function endpointForTier(config: ResolvedSurveilConfig, tier: number): string | undefined {
  return config.tiers.find((entry) => entry.tier === tier)?.endpoint;
}

/** The tier number for a custom endpoint name, or undefined when it is not a Surveil tier. */
export function tierForEndpoint(
  config: ResolvedSurveilConfig,
  endpoint: string,
): number | undefined {
  return config.tiers.find((entry) => entry.endpoint === endpoint)?.tier;
}

/** The OpenRouter key name for a user and tier. Not a secret. */
export function openRouterKeyName(userId: string, tier: number): string {
  return `surveil:${userId}:${tier}`;
}

/** The prefix used to find all of a user's keys. */
export function openRouterKeyPrefix(userId: string): string {
  return `surveil:${userId}:`;
}
