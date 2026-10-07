import { usdToMicro } from './money';

/** Cumulative OpenRouter lifetime usage per tier, in micro-USD. */
export interface TierUsageMicro {
  tier1: number;
  tier2: number;
  tier3: number;
}

export function emptyTierUsage(): TierUsageMicro {
  return { tier1: 0, tier2: 0, tier3: 0 };
}

/** Convert per-tier OpenRouter usage floats (USD) to micro-USD. */
export function tierUsageFromUsd(usage: {
  tier1?: number;
  tier2?: number;
  tier3?: number;
}): TierUsageMicro {
  return {
    tier1: usdToMicro(usage.tier1 ?? 0),
    tier2: usdToMicro(usage.tier2 ?? 0),
    tier3: usdToMicro(usage.tier3 ?? 0),
  };
}

/** Sum of per-tier lifetime usage in micro-USD. */
export function totalUsageMicro(usage: TierUsageMicro): number {
  return usage.tier1 + usage.tier2 + usage.tier3;
}

/** Spend within the current period: current lifetime usage minus the period snapshot. */
export function periodSpendMicro(current: TierUsageMicro, snapshot: TierUsageMicro): number {
  return Math.max(0, totalUsageMicro(current) - totalUsageMicro(snapshot));
}

/** Remaining credits in micro-USD, never negative. */
export function remainingMicro(options: {
  grantMicro: number;
  current: TierUsageMicro;
  snapshot: TierUsageMicro;
}): number {
  return Math.max(0, options.grantMicro - periodSpendMicro(options.current, options.snapshot));
}

export type KeyLimitMode = 'allocate' | 'duplicate';

/**
 * The OpenRouter `limit` to set on one key. `usage` is that key's own lifetime usage.
 *
 * - `duplicate`: every key may spend the full remaining pool (worst case N × remaining).
 * - `allocate`: only the active tier's key carries the pool; others get no headroom, bounding
 *   overspend to roughly one remaining pool plus one in-flight request.
 */
export function keyLimitMicro(options: {
  keyUsageMicro: number;
  remainingMicro: number;
  mode: KeyLimitMode;
  isActive: boolean;
}): number {
  const { keyUsageMicro, remainingMicro: remaining, mode, isActive } = options;
  if (mode === 'allocate' && !isActive) return keyUsageMicro;
  return keyUsageMicro + Math.max(remaining, 0);
}

/** True when the key should be disabled because there is no credit left. */
export function shouldDisableForCredits(remaining: number): boolean {
  return remaining <= 0;
}
