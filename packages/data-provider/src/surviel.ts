/** Shared Surviel-Me-Not subscription/credit types used by the client and server. */

export type TSurvielPlanKey = '50' | '100' | '200';

export interface TSurvielTierSpend {
  tier1: number;
  tier2: number;
  tier3: number;
}

export interface TSurvielStartupTier {
  tier: number;
  endpoint: string;
  description: string;
}

/** The safe subset of Surviel config exposed to the client via the startup config. */
export interface TSurvielStartupConfig {
  enabled: boolean;
  lowBalanceThresholdUsd: number;
  tiers: TSurvielStartupTier[];
}

export interface TSurvielCredits {
  plan: string | null;
  status: string;
  periodStart: string | null;
  renewsAt: string | null;
  grantUSD: number;
  spentUSD: number;
  remainingUSD: number;
  perTier: TSurvielTierSpend;
  lastSyncedAt: string | null;
  lowBalance: boolean;
}

export interface TSurvielModelPrice {
  id: string;
  name: string;
  contextLength: number | null;
  /** USD per 1M prompt tokens. */
  promptPerMillionUsd: number;
  /** USD per 1M completion tokens. */
  completionPerMillionUsd: number;
}

export interface TSurvielPricingResponse {
  models: Record<string, TSurvielModelPrice>;
  fetchedAt: string | null;
}

export interface TSurvielCheckoutRequest {
  plan: TSurvielPlanKey;
}

export interface TSurvielCheckoutResponse {
  url: string | null;
  id?: string;
}

export interface TSurvielPortalResponse {
  url: string | null;
}
