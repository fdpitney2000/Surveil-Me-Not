import { usdToMicro } from './money';

export type PlanKey = '50' | '100' | '200';

export interface SurvielPlan {
  key: PlanKey;
  priceId: string;
  priceMicro: number;
}

const PLAN_DEFS: Array<{ key: PlanKey; env: string; usd: number }> = [
  { key: '50', env: 'STRIPE_PRICE_50_ID', usd: 50 },
  { key: '100', env: 'STRIPE_PRICE_100_ID', usd: 100 },
  { key: '200', env: 'STRIPE_PRICE_200_ID', usd: 200 },
];

/** Resolve the configured plans from env price IDs. Missing prices are omitted. */
export function resolvePlans(env: NodeJS.ProcessEnv = process.env): SurvielPlan[] {
  const plans: SurvielPlan[] = [];
  for (const def of PLAN_DEFS) {
    const priceId = env[def.env];
    if (priceId) {
      plans.push({ key: def.key, priceId, priceMicro: usdToMicro(def.usd) });
    }
  }
  return plans;
}

export function planForPriceId(
  priceId: string | null | undefined,
  plans: SurvielPlan[] = resolvePlans(),
): SurvielPlan | undefined {
  if (!priceId) return undefined;
  return plans.find((plan) => plan.priceId === priceId);
}
