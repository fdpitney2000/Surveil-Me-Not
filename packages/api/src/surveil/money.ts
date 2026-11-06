/** All Surveil money is stored and computed as integer micro-USD. 1 USD = 1_000_000. */
export const USD_MICRO = 1_000_000;

/** Convert a USD amount (e.g. an OpenRouter float) to integer micro-USD. */
export function usdToMicro(usd: number): number {
  return Math.round(usd * USD_MICRO);
}

/** Convert integer micro-USD to a USD number. Use only for display or external APIs. */
export function microToUsd(micro: number): number {
  return micro / USD_MICRO;
}

/** Format micro-USD as a fixed 2-decimal USD string. */
export function formatUsd(micro: number): string {
  return (micro / USD_MICRO).toFixed(2);
}

/** Multiply micro-USD by a ratio, rounding to the nearest micro. */
export function multiplyMicro(micro: number, ratio: number): number {
  return Math.round(micro * ratio);
}

/** A percentage of micro-USD (e.g. 2.9 for 2.9%), rounded. */
export function percentOfMicro(micro: number, percent: number): number {
  return Math.round((micro * percent) / 100);
}

/** The Stripe fee in micro-USD: percent of price plus the fixed fee. */
export function stripeFeeMicro(priceMicro: number, percent: number, fixedUsd: number): number {
  return percentOfMicro(priceMicro, percent) + usdToMicro(fixedUsd);
}

/** The monthly credit grant in micro-USD: plan price times the grant ratio. */
export function grantMicro(priceMicro: number, ratio: number): number {
  return multiplyMicro(priceMicro, ratio);
}

/**
 * The amount loaded onto a customer's OpenRouter key for a paid period. This is the plan
 * price minus Surveil's retention, the Stripe processing fee, and OpenRouter's
 * credit-purchase fee. All percentages are applied to the gross price, matching the
 * margin model in PLAN-BETA.md.
 */
export function netProceedsMicro(
  priceMicro: number,
  fees: {
    retentionPct: number;
    stripeFeePct: number;
    stripeFeeFixedUsd: number;
    openrouterFeePct: number;
  },
): number {
  const retention = percentOfMicro(priceMicro, fees.retentionPct);
  const stripe = stripeFeeMicro(priceMicro, fees.stripeFeePct, fees.stripeFeeFixedUsd);
  const openrouter = percentOfMicro(priceMicro, fees.openrouterFeePct);
  return Math.max(0, priceMicro - retention - stripe - openrouter);
}

/**
 * Net margin in micro-USD at a utilization level `u` (fraction of granted credits actually
 * spent). Cost is only incurred on spend, plus the OpenRouter credit-purchase fee.
 */
export function netMarginMicro(options: {
  priceMicro: number;
  grantMicro: number;
  stripeFeeMicro: number;
  openrouterFeePercent: number;
  utilization: number;
}): number {
  const {
    priceMicro,
    grantMicro: grant,
    stripeFeeMicro: stripeFee,
    openrouterFeePercent,
  } = options;
  const openRouterCost = multiplyMicro(grant * options.utilization, 1 + openrouterFeePercent / 100);
  return priceMicro - stripeFee - openRouterCost;
}
