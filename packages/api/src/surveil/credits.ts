import type { ISurveilSubscription } from '@librechat/data-schemas';
import type { TSurveilCredits } from 'librechat-data-provider';
import { periodSpendMicro, remainingMicro } from './period';
import { microToUsd } from './money';

export type CreditsResponse = TSurveilCredits;

function iso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

/** Build the client-facing credits payload from a subscription's last-known state. */
export function buildCreditsResponse(options: {
  subscription: ISurveilSubscription | null;
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
      lastSyncedAt: null,
      lowBalance: false,
    };
  }

  const snapshotMicro = subscription.snapshotUsageMicro ?? 0;
  const currentMicro = subscription.usageMicro ?? 0;
  const grantMicro = subscription.grantMicroUsd ?? 0;
  const spent = periodSpendMicro(currentMicro, snapshotMicro);
  const remaining = remainingMicro({
    grantMicro,
    currentMicro,
    snapshotMicro,
  });

  return {
    plan: subscription.plan ?? null,
    status: subscription.status,
    periodStart: iso(subscription.periodStart),
    renewsAt: iso(subscription.renewsAt),
    grantUSD: microToUsd(grantMicro),
    spentUSD: microToUsd(spent),
    remainingUSD: microToUsd(remaining),
    lastSyncedAt: iso(subscription.lastSyncedAt),
    lowBalance: microToUsd(remaining) <= lowBalanceThresholdUsd,
  };
}
