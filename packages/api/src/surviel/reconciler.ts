import type { ISurvielSubscription } from '@librechat/data-schemas';
import type { SurvielWebhookLogger } from './stripe/webhook';
import type { OpenRouterClient } from './openrouter/client';
import type { ResolvedSurvielConfig } from './config';
import type { TierUsageMicro } from './period';
import { emptyTierUsage, remainingMicro } from './period';
import { fetchUserUsage } from './openrouter/usage';
import { microToUsd, usdToMicro } from './money';
import { isLeader } from '~/cluster';

/** The subscription methods the reconciler needs (a subset of the aggregated methods). */
export interface SurvielReconcileDb {
  getSurvielSubscriptionByUser: (userId: string) => Promise<ISurvielSubscription | null>;
  listSurvielSubscriptions: (filter?: Record<string, unknown>) => Promise<ISurvielSubscription[]>;
  upsertSurvielSubscription: (
    filter: Record<string, unknown>,
    update: Partial<ISurvielSubscription>,
  ) => Promise<ISurvielSubscription | null>;
}

export interface ReconcileSummary {
  userId: string;
  remainingMicro: number;
  disabled: boolean;
  activeTier: number;
}

/** Whether the subscription currently permits spending (grace and period-end rules applied). */
export function isSubscriptionUsable(
  subscription: ISurvielSubscription | null,
  now: Date,
): boolean {
  if (!subscription) return false;
  switch (subscription.status) {
    case 'active':
      return true;
    case 'past_due':
    case 'grace':
      return subscription.graceUntil ? now < new Date(subscription.graceUntil) : true;
    case 'canceled':
      return subscription.renewsAt ? now < new Date(subscription.renewsAt) : false;
    case 'disabled':
    case 'review':
      return false;
    default:
      return false;
  }
}

/** Pick the tier with the largest usage increase since the last reconcile; else keep current. */
export function chooseActiveTier(
  subscription: ISurvielSubscription,
  current: TierUsageMicro,
): number {
  const previous = subscription.usageByTier ?? emptyTierUsage();
  const deltas = [
    { tier: 1, delta: current.tier1 - previous.tier1 },
    { tier: 2, delta: current.tier2 - previous.tier2 },
    { tier: 3, delta: current.tier3 - previous.tier3 },
  ];
  let active = subscription.activeTier ?? 1;
  let best = 0;
  for (const entry of deltas) {
    if (entry.delta > best) {
      best = entry.delta;
      active = entry.tier;
    }
  }
  return active;
}

/**
 * Reconcile one subscription: read OpenRouter usage, compute remaining credits, apply key
 * limits for the configured mode, and enable/disable keys. Never throws on a per-key basis.
 */
export async function reconcileSubscription(options: {
  db: SurvielReconcileDb;
  client: OpenRouterClient;
  config: ResolvedSurvielConfig;
  subscription: ISurvielSubscription;
  now?: Date;
}): Promise<ReconcileSummary> {
  const { db, client, config, subscription } = options;
  const now = options.now ?? new Date();
  const userId = String(subscription.userId);

  const { usage, keys } = await fetchUserUsage({ client, userId });
  const snapshot = subscription.snapshotByTier ?? emptyTierUsage();
  const remaining = remainingMicro({
    grantMicro: subscription.grantMicroUsd ?? 0,
    current: usage,
    snapshot,
  });

  const usable = isSubscriptionUsable(subscription, now);
  const activeTier = usable
    ? chooseActiveTier(subscription, usage)
    : (subscription.activeTier ?? 1);
  const reserve = usdToMicro(config.lowBalanceThresholdUsd);
  const disableAll = !usable || remaining <= 0;

  for (const key of keys) {
    if (disableAll) {
      if (!key.disabled) await client.updateKey(key.hash, { disabled: true });
      continue;
    }
    if (key.disabled) await client.updateKey(key.hash, { disabled: false });
    const isActive = config.keyLimitMode === 'duplicate' || key.tier === activeTier;
    const headroom = isActive ? remaining : Math.min(reserve, remaining);
    const limitMicro = usdToMicro(key.usageUsd) + headroom;
    await client.updateKey(key.hash, { limit: microToUsd(limitMicro) });
  }

  await db.upsertSurvielSubscription(
    { userId },
    { usageByTier: usage, activeTier, lastSyncedAt: now },
  );

  return { userId, remainingMicro: remaining, disabled: disableAll, activeTier };
}

/** Reconcile every known subscription. Per-user failures are logged and skipped. */
export async function reconcileAll(options: {
  db: SurvielReconcileDb;
  client: OpenRouterClient;
  config: ResolvedSurvielConfig;
  now?: Date;
  logger?: SurvielWebhookLogger;
}): Promise<ReconcileSummary[]> {
  const subscriptions = await options.db.listSurvielSubscriptions({});
  const summaries: ReconcileSummary[] = [];
  for (const subscription of subscriptions) {
    try {
      summaries.push(
        await reconcileSubscription({
          db: options.db,
          client: options.client,
          config: options.config,
          subscription,
          now: options.now,
        }),
      );
    } catch (error) {
      options.logger?.warn('[Surviel] Reconcile failed for user:', subscription.userId, error);
    }
  }
  return summaries;
}

let reconcileTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Start the leader-gated periodic reconciler. Mirrors the code-environment lifecycle
 * reconciler: one interval per process, unref'd, in-flight guarded.
 */
export function startSurvielReconciler(options: {
  db: SurvielReconcileDb;
  client: OpenRouterClient | undefined;
  config: ResolvedSurvielConfig;
  logger?: SurvielWebhookLogger;
}): void {
  if (reconcileTimer != null) return;
  if (!options.config.enabled || !options.client) return;

  let inFlight = false;
  const run = () => {
    if (inFlight) return;
    inFlight = true;
    void isLeader()
      .then(async (leader) => {
        if (!leader) return;
        await reconcileAll({
          db: options.db,
          client: options.client as OpenRouterClient,
          config: options.config,
          logger: options.logger,
        });
      })
      .catch((error) => options.logger?.warn('[Surviel] Reconciler run failed:', error))
      .finally(() => {
        inFlight = false;
      });
  };

  run();
  reconcileTimer = setInterval(run, options.config.reconcileIntervalMs);
  reconcileTimer.unref();
}
