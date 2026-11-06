/** Cumulative OpenRouter key usage is stored as integer micro-USD. */

/** Spend within the current period: current usage minus the period snapshot. */
export function periodSpendMicro(currentMicro: number, snapshotMicro: number): number {
  return Math.max(0, currentMicro - snapshotMicro);
}

/** Remaining spendable credit in micro-USD, never negative. */
export function remainingMicro(options: {
  grantMicro: number;
  currentMicro: number;
  snapshotMicro: number;
}): number {
  return Math.max(
    0,
    options.grantMicro - periodSpendMicro(options.currentMicro, options.snapshotMicro),
  );
}

/**
 * The OpenRouter `limit` to set on a key. `usage` is that key's own lifetime usage, so the
 * key is allowed to spend its current usage plus the remaining pool.
 */
export function keyLimitMicro(options: { keyUsageMicro: number; remainingMicro: number }): number {
  return options.keyUsageMicro + Math.max(options.remainingMicro, 0);
}

/** True when the key should be disabled because there is no credit left. */
export function shouldDisableForCredits(remaining: number): boolean {
  return remaining <= 0;
}
