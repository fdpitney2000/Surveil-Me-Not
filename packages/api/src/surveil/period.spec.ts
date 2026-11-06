import {
  keyLimitMicro,
  periodSpendMicro,
  remainingMicro,
  shouldDisableForCredits,
} from './period';

describe('period math (integer micro-USD)', () => {
  it('computes period spend from the snapshot', () => {
    expect(periodSpendMicro(6_000_000, 1_000_000)).toBe(5_000_000);
  });

  it('never reports negative spend or remaining', () => {
    expect(periodSpendMicro(1_000_000, 3_000_000)).toBe(0);
    expect(
      remainingMicro({
        grantMicro: 5_000_000,
        currentMicro: 100_000_000,
        snapshotMicro: 0,
      }),
    ).toBe(0);
  });

  it('adds the remaining pool to the key usage for the key limit', () => {
    expect(keyLimitMicro({ keyUsageMicro: 2_000_000, remainingMicro: 10_000_000 })).toBe(
      12_000_000,
    );
  });

  it('disables keys only when remaining is exhausted', () => {
    expect(shouldDisableForCredits(0)).toBe(true);
    expect(shouldDisableForCredits(-1)).toBe(true);
    expect(shouldDisableForCredits(1)).toBe(false);
  });
});
