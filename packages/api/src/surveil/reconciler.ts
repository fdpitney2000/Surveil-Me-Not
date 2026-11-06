import type { ISurveilSubscription } from '@librechat/data-schemas';
import type { SurveilWebhookLogger } from './stripe/webhook';
import type { OpenRouterClient } from './openrouter/client';
import type { ResolvedSurveilConfig } from './config';
import type { UserKeyUsage } from './openrouter/usage';
import { remainingMicro, keyLimitMicro } from './period';
import { fetchUserUsage } from './openrouter/usage';
import { microToUsd, usdToMicro } from './money';
import { isLeader } from '~/cluster';

/** The subscription methods the reconciler needs (a subset of the aggregated methods). */
export interface SurveilReconcileDb {
  getSurveilSubscriptionByUser: (userId: string) => Promise<ISurveilSubscription | null>;
  listSurveilSubscriptions: (filter?: Record<string, unknown>) => Promise<ISurveilSubscription[]>;
  upsertSurveilSubscription: (
    filter: Record<string, unknown>,
    update: Partial<ISurveilSubscription>,
  ) => Promise<ISurveilSubscription | null>;
}

export interface ReconcileSummary {
  userId: string;
  remainingMicro: number;
  disabled: boolean;
}

/** Whether the subscription currently permits spending (grace and period-end rules applied). */
export function isSubscriptionUsable(
  subscription: ISurveilSubscription | null,
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

/** Prefer the newest enabled key; fall back to the newest key so it can be disabled. */
function pickPrimaryKey(keys: UserKeyUsage[]): UserKeyUsage | undefined {
  if (keys.length === 0) return undefined;
  const enabled = keys.filter((key) => !key.disabled);
  const pool = enabled.length > 0 ? enabled : keys;
  return [...pool].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  )[0];
}

function isExpired(key: UserKeyUsage, now: Date): boolean {
  return Boolean(key.expiresAt && new Date(key.expiresAt) <= now);
}

/**
 * Reconcile one subscription: read OpenRouter usage, compute remaining credits, keep one
 * current key enabled with the remaining pool as its limit, and disable stale/legacy keys.
 */
export async function reconcileSubscription(options: {
  db: SurveilReconcileDb;
  client: OpenRouterClient;
  config: ResolvedSurveilConfig;
  subscription: ISurveilSubscription;
  now?: Date;
}): Promise<ReconcileSummary> {
  const { db, client, config, subscription } = options;
  const now = options.now ?? new Date();
  const userId = String(subscription.userId);

  const { usageMicro, keys } = await fetchUserUsage({ client, userId });
  const snapshotMicro = subscription.snapshotUsageMicro ?? 0;
  const remaining = remainingMicro({
    grantMicro: subscription.grantMicroUsd ?? 0,
    currentMicro: usageMicro,
    snapshotMicro,
  });

  const usable = isSubscriptionUsable(subscription, now);
  const disableAll = !usable || remaining <= 0;
  const primary = pickPrimaryKey(keys);

  for (const key of keys) {
    const isPrimary = primary?.hash === key.hash;
    if (disableAll || !isPrimary || isExpired(key, now)) {
      if (!key.disabled) await client.updateKey(key.hash, { disabled: true });
      continue;
    }
    if (key.disabled) await client.updateKey(key.hash, { disabled: false });
    const limitMicro = keyLimitMicro({
      keyUsageMicro: usdToMicro(key.usageUsd),
      remainingMicro: remaining,
    });
    await client.updateKey(key.hash, { limit: microToUsd(limitMicro) });
  }

  await db.upsertSurveilSubscription(
    { userId },
    {
      usageMicro,
      lastSyncedAt: now,
      ...(primary ? { keyHash: primary.hash } : {}),
    },
  );

  return { userId, remainingMicro: remaining, disabled: disableAll };
}

/** Reconcile every known subscription. Per-user failures are logged and skipped. */
export async function reconcileAll(options: {
  db: SurveilReconcileDb;
  client: OpenRouterClient;
  config: ResolvedSurveilConfig;
  now?: Date;
  logger?: SurveilWebhookLogger;
}): Promise<ReconcileSummary[]> {
  const subscriptions = await options.db.listSurveilSubscriptions({});
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
      options.logger?.warn('[Surveil] Reconcile failed for user:', subscription.userId, error);
    }
  }
  return summaries;
}

let reconcileTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Start the leader-gated periodic reconciler. Mirrors the code-environment lifecycle
 * reconciler: one interval per process, unref'd, in-flight guarded.
 */
export function startSurveilReconciler(options: {
  db: SurveilReconcileDb;
  client: OpenRouterClient | undefined;
  config: ResolvedSurveilConfig;
  logger?: SurveilWebhookLogger;
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
      .catch((error) => options.logger?.warn('[Surveil] Reconciler run failed:', error))
      .finally(() => {
        inFlight = false;
      });
  };

  run();
  reconcileTimer = setInterval(run, options.config.reconcileIntervalMs);
  reconcileTimer.unref();
}
