import { grantMicro, netMarginMicro, stripeFeeMicro, usdToMicro } from './money';

describe('money', () => {
  it('converts USD to integer micro-USD with rounding', () => {
    expect(usdToMicro(1)).toBe(1_000_000);
    expect(usdToMicro(0.0000005)).toBe(1);
    expect(Number.isInteger(usdToMicro(12.345678))).toBe(true);
  });

  it('computes the Stripe fee', () => {
    // $50 at 2.9% + $0.30 = $1.75
    expect(stripeFeeMicro(usdToMicro(50), 2.9, 0.3)).toBe(usdToMicro(1.75));
  });

  it('computes the grant from the ratio', () => {
    expect(grantMicro(usdToMicro(100), 0.9)).toBe(usdToMicro(90));
  });

  it('computes margin at full and partial utilization', () => {
    const priceMicro = usdToMicro(50);
    const grant = grantMicro(priceMicro, 0.9);
    const stripeFee = stripeFeeMicro(priceMicro, 2.9, 0.3);

    const full = netMarginMicro({
      priceMicro,
      grantMicro: grant,
      stripeFeeMicro: stripeFee,
      openrouterFeePercent: 5.5,
      utilization: 1,
    });
    // 50 - 1.75 - 45*1.055 = 0.775
    expect(full).toBeCloseTo(usdToMicro(0.775), -1);

    const half = netMarginMicro({
      priceMicro,
      grantMicro: grant,
      stripeFeeMicro: stripeFee,
      openrouterFeePercent: 5.5,
      utilization: 0.5,
    });
    expect(half).toBeGreaterThan(full);
  });

  it('can be negative when fees exceed margin', () => {
    const priceMicro = usdToMicro(50);
    const margin = netMarginMicro({
      priceMicro,
      grantMicro: grantMicro(priceMicro, 0.9),
      stripeFeeMicro: stripeFeeMicro(priceMicro, 2.9, 0.3),
      openrouterFeePercent: 10,
      utilization: 1,
    });
    expect(margin).toBeLessThan(0);
  });
});
