import {
  keyLimitMicro,
  periodSpendMicro,
  remainingMicro,
  shouldDisableForCredits,
  tierUsageFromUsd,
  totalUsageMicro,
} from './period';

describe('period math (integer micro-USD)', () => {
  it('converts per-tier usage and sums it', () => {
    const usage = tierUsageFromUsd({ tier1: 1, tier2: 2, tier3: 3 });
    expect(totalUsageMicro(usage)).toBe(6_000_000);
  });

  it('computes period spend from the snapshot', () => {
    const snapshot = tierUsageFromUsd({ tier1: 1, tier2: 0, tier3: 0 });
    const current = tierUsageFromUsd({ tier1: 3, tier2: 2, tier3: 1 });
    expect(periodSpendMicro(current, snapshot)).toBe(5_000_000);
  });

  it('never reports negative remaining', () => {
    const remaining = remainingMicro({
      grantMicro: 5_000_000,
      current: tierUsageFromUsd({ tier1: 100 }),
      snapshot: tierUsageFromUsd({}),
    });
    expect(remaining).toBe(0);
  });

  it('allocate mode gives the pool only to the active tier', () => {
    const remaining = 10_000_000;
    expect(
      keyLimitMicro({
        keyUsageMicro: 2_000_000,
        remainingMicro: remaining,
        mode: 'allocate',
        isActive: true,
      }),
    ).toBe(12_000_000);
    expect(
      keyLimitMicro({
        keyUsageMicro: 2_000_000,
        remainingMicro: remaining,
        mode: 'allocate',
        isActive: false,
      }),
    ).toBe(2_000_000);
  });

  it('duplicate mode gives the pool to every tier', () => {
    expect(
      keyLimitMicro({
        keyUsageMicro: 0,
        remainingMicro: 10_000_000,
        mode: 'duplicate',
        isActive: false,
      }),
    ).toBe(10_000_000);
  });

  it('disables keys only when remaining is exhausted', () => {
    expect(shouldDisableForCredits(0)).toBe(true);
    expect(shouldDisableForCredits(-1)).toBe(true);
    expect(shouldDisableForCredits(1)).toBe(false);
  });
});
