import type { ISurvielSubscription } from '@librechat/data-schemas';
import type { TSurvielCredits } from 'librechat-data-provider';
import type { TierUsageMicro } from './period';
import { emptyTierUsage, periodSpendMicro, remainingMicro } from './period';
import { microToUsd } from './money';

export type CreditsResponse = TSurvielCredits;

function iso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function tierDelta(current: TierUsageMicro, snapshot: TierUsageMicro) {
  return {
    tier1: Math.max(0, current.tier1 - snapshot.tier1),
    tier2: Math.max(0, current.tier2 - snapshot.tier2),
    tier3: Math.max(0, current.tier3 - snapshot.tier3),
  };
}

/** Build the client-facing credits payload from a subscription's last-known state. */
export function buildCreditsResponse(options: {
  subscription: ISurvielSubscription | null;
  lowBalanceThresholdUsd: number;
}): CreditsResponse {
  const { subscription, lowBalanceThresholdUsd } = options;
  if (!subscription) {
    return {
      plan: null,
      status: 'none',
      periodStart: null,
      renewsAt: null,
      grantUSD: 0,
      spentUSD: 0,
      remainingUSD: 0,
      perTier: { tier1: 0, tier2: 0, tier3: 0 },
      lastSyncedAt: null,
      lowBalance: false,
    };
  }

  const snapshot = subscription.snapshotByTier ?? emptyTierUsage();
  const current = subscription.usageByTier ?? emptyTierUsage();
  const grantMicro = subscription.grantMicroUsd ?? 0;
  const spent = periodSpendMicro(current, snapshot);
  const remaining = remainingMicro({ grantMicro, current, snapshot });
  const perTierMicro = tierDelta(current, snapshot);

  return {
    plan: subscription.plan ?? null,
    status: subscription.status,
    periodStart: iso(subscription.periodStart),
    renewsAt: iso(subscription.renewsAt),
    grantUSD: microToUsd(grantMicro),
    spentUSD: microToUsd(spent),
    remainingUSD: microToUsd(remaining),
    perTier: {
      tier1: microToUsd(perTierMicro.tier1),
      tier2: microToUsd(perTierMicro.tier2),
      tier3: microToUsd(perTierMicro.tier3),
    },
    lastSyncedAt: iso(subscription.lastSyncedAt),
    lowBalance: microToUsd(remaining) <= lowBalanceThresholdUsd,
  };
}
