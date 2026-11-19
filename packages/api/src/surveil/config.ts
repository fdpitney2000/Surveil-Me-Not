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

  const retentionPct = envNumber('RETENTION_PCT');
  if (retentionPct !== undefined) overrides.retentionPct = retentionPct;

  const stripeFeePct = envNumber('STRIPE_FEE_PCT');
  if (stripeFeePct !== undefined) overrides.stripeFeePct = stripeFeePct;

  const stripeFeeFixedUsd = envNumber('STRIPE_FEE_FIXED');
  if (stripeFeeFixedUsd !== undefined) overrides.stripeFeeFixedUsd = stripeFeeFixedUsd;

  const openrouterFeePct = envNumber('OPENROUTER_FEE_PCT');
  if (openrouterFeePct !== undefined) overrides.openrouterFeePct = openrouterFeePct;

  const freeTierEnabled = envBoolean('SURVEIL_FREE_TIER');
  if (freeTierEnabled !== undefined) overrides.freeTierEnabled = freeTierEnabled;

  const freeTierMonthlyUsd = envNumber('SURVEIL_FREE_MONTHLY_USD');
  if (freeTierMonthlyUsd !== undefined) overrides.freeTierMonthlyUsd = freeTierMonthlyUsd;

  const freeTierGlobalUsd = envNumber('SURVEIL_FREE_GLOBAL_USD');
  if (freeTierGlobalUsd !== undefined) overrides.freeTierGlobalUsd = freeTierGlobalUsd;

  const freeTierMaxModels = envNumber('SURVEIL_FREE_MAX_MODELS');
  if (freeTierMaxModels !== undefined) overrides.freeTierMaxModels = freeTierMaxModels;

  const freeTierMaxOutputPrice = envNumber('SURVEIL_FREE_MAX_OUTPUT_PRICE_PER_MILLION_USD');
  if (freeTierMaxOutputPrice !== undefined) {
    overrides.freeTierMaxOutputPricePerMillionUsd = freeTierMaxOutputPrice;
  }

  const freeTierMaxAgeDays = envNumber('SURVEIL_FREE_MAX_AGE_DAYS');
  if (freeTierMaxAgeDays !== undefined) overrides.freeTierMaxAgeDays = freeTierMaxAgeDays;

  const freeTierPinnedModel = process.env.SURVEIL_FREE_PINNED_MODEL?.trim();
  if (freeTierPinnedModel) overrides.freeTierPinnedModel = freeTierPinnedModel;

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

/** Whether a custom endpoint name is one of the configured Surveil tiers. */
export function isSurveilTierEndpoint(
  rawConfig: Partial<TSurveilConfig> | undefined,
  endpoint: string,
): boolean {
  const config = resolveSurveilConfig(rawConfig);
  return config.enabled && config.tiers.some((tier) => tier.endpoint === endpoint);
}

/** The OpenRouter key name for a user. Not a secret. */
export function openRouterKeyName(userId: string): string {
  return `surveil:${userId}`;
}

/** The prefix used to find a user's current and legacy keys. */
export function openRouterKeyPrefix(userId: string): string {
  return `surveil:${userId}`;
}

/** The subsidized free-tier key name. */
export function freeOpenRouterKeyName(userId: string): string {
  return `surveil:free:${userId}`;
}

/** The prefix used to find a user's free-tier keys. */
export function freeOpenRouterKeyPrefix(userId: string): string {
  return `surveil:free:${userId}`;
}

/** True for the exact user key, legacy per-tier keys, or the user's free-tier key. */
export function isOpenRouterKeyForUser(name: string, userId: string): boolean {
  const prefix = openRouterKeyPrefix(userId);
  const freePrefix = freeOpenRouterKeyPrefix(userId);
  return name === prefix || name.startsWith(`${prefix}:`) || name === freePrefix;
}
