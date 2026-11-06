/** Shared Surveil-Me-Not subscription/credit types used by the client and server. */

export type TSurveilPlanKey = '50' | '100' | '200';

export interface TSurveilStartupTier {
  tier: number;
  endpoint: string;
  description: string;
}

/** The safe subset of Surveil config exposed to the client via the startup config. */
export interface TSurveilStartupConfig {
  enabled: boolean;
  lowBalanceThresholdUsd: number;
  tiers: TSurveilStartupTier[];
}

export interface TSurveilCredits {
  plan: string | null;
  status: string;
  periodStart: string | null;
  renewsAt: string | null;
  grantUSD: number;
  spentUSD: number;
  remainingUSD: number;
  lastSyncedAt: string | null;
  lowBalance: boolean;
}

export interface TSurveilModelPrice {
  id: string;
  name: string;
  contextLength: number | null;
  /** USD per 1M prompt tokens. */
  promptPerMillionUsd: number;
  /** USD per 1M completion tokens. */
  completionPerMillionUsd: number;
}

export interface TSurveilPricingResponse {
  models: Record<string, TSurveilModelPrice>;
  fetchedAt: string | null;
}

/**
 * Whether a model costs nothing to call. Prefers the pricing snapshot; falls back to
 * OpenRouter's `:free` id suffix when pricing has not loaded (so free models are never
 * locked behind a pricing outage).
 */
export function isSurveilFreeModel(
  modelId: string,
  models?: Record<string, TSurveilModelPrice> | null,
): boolean {
  const price = models?.[modelId];
  if (price) {
    return price.promptPerMillionUsd === 0 && price.completionPerMillionUsd === 0;
  }
  return modelId.endsWith(':free');
}

/**
 * Stable partition: free models first, paid after, preserving the fetched order within
 * each group. Applied to Surveil tier pickers so free users can navigate the models they
 * can actually call; paid rows stay visible (locked until subscribed).
 */
export function sortSurveilModelsFreeFirst(
  modelIds: string[],
  models?: Record<string, TSurveilModelPrice> | null,
): string[] {
  const free: string[] = [];
  const paid: string[] = [];
  for (const modelId of modelIds) {
    (isSurveilFreeModel(modelId, models) ? free : paid).push(modelId);
  }
  return [...free, ...paid];
}

export interface TSurveilCheckoutRequest {
  plan: TSurveilPlanKey;
}

export interface TSurveilCheckoutResponse {
  url: string | null;
  id?: string;
}

export interface TSurveilPortalResponse {
  url: string | null;
}
