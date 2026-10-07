import type { ISurvielSubscription } from '@librechat/data-schemas';
import type Stripe from 'stripe';
import type { ResolvedSurvielConfig } from '../config';
import type { SurvielKeyStore } from '../provision';
import type { TierUsageMicro } from '../period';
import { openRouterKeyPrefix, resolveSurvielConfig } from '../config';
import { provisionUserKeys, setUserKeysDisabled } from '../provision';
import { createOpenRouterClientFromEnv } from '../openrouter/client';
import { createStripeClient, resolveWebhookSecret } from './client';
import { emptyTierUsage, tierUsageFromUsd } from '../period';
import { SurvielError, SurvielErrorCodes } from '../errors';
import { planForPriceId } from '../plans';
import { grantMicro } from '../money';

/** The database methods the webhook needs (a subset of the aggregated methods). */
export interface SurvielWebhookDb extends SurvielKeyStore {
  getSurvielSubscriptionByUser: (userId: string) => Promise<ISurvielSubscription | null>;
  getSurvielSubscriptionByCustomer: (customerId: string) => Promise<ISurvielSubscription | null>;
  upsertSurvielSubscription: (
    filter: Record<string, unknown>,
    update: Partial<ISurvielSubscription>,
  ) => Promise<ISurvielSubscription | null>;
  createSurvielPeriod: (input: {
    userId: string;
    invoiceId: string;
    plan?: string | undefined;
    grantMicroUsd: number;
    snapshotByTier: TierUsageMicro;
    periodStart?: Date | undefined;
    periodEnd?: Date | undefined;
    kind?: 'cycle' | 'proration' | undefined;
  }) => Promise<{ created: boolean }>;
  recordSurvielEvent: (input: {
    eventId: string;
    type: string;
    created: number;
    status?: 'processed' | 'ignored' | 'error';
    note?: string;
  }) => Promise<{ duplicate: boolean }>;
}

export interface SurvielWebhookLogger {
  warn: (...args: unknown[]) => void;
  info?: (...args: unknown[]) => void;
}

export interface StripeWebhookDeps {
  db: SurvielWebhookDb;
  config: ResolvedSurvielConfig;
  stripe: Stripe;
  provisionUser: (userId: string) => Promise<void>;
  disableUserKeys: (userId: string) => Promise<void>;
  snapshotUsage: (userId: string) => Promise<TierUsageMicro>;
  now?: () => Date;
  logger?: SurvielWebhookLogger;
}

export interface ApplyResult {
  handled: boolean;
  duplicate: boolean;
  reason?: string;
}

function idOf(value: unknown): string | undefined {
  if (!value) return undefined;
  if (typeof value === 'string') return value;
  if (typeof value === 'object' && 'id' in value) {
    const id = (value as { id?: unknown }).id;
    if (typeof id === 'string') return id;
  }
  return undefined;
}

type LooseInvoice = Stripe.Invoice & {
  id: string;
  subscription?: string | Stripe.Subscription | null;
  subscription_details?: {
    subscription?: string | Stripe.Subscription | null;
    metadata?: Record<string, string>;
  };
  parent?: {
    subscription_details?: {
      subscription?: string | Stripe.Subscription | null;
      metadata?: Record<string, string>;
    };
  };
};

interface InvoiceContext {
  userId?: string;
  customerId?: string;
  subscriptionId?: string;
  priceId?: string;
  periodEnd?: Date;
  billingReason?: string;
  metadataUserId?: string;
}

type LooseInvoiceLine = {
  price?: { id?: string } | null;
  pricing?: { price_details?: { price?: string } } | null;
};

/** The price id on the first invoice line, tolerating both Stripe API shapes. */
function linePriceId(invoice: LooseInvoice): string | undefined {
  const line = invoice.lines?.data?.[0] as LooseInvoiceLine | undefined;
  return line?.price?.id ?? line?.pricing?.price_details?.price;
}

function invoiceContext(invoice: LooseInvoice): InvoiceContext {
  const subscriptionId =
    idOf(invoice.subscription) ?? idOf(invoice.parent?.subscription_details?.subscription);
  return {
    customerId: idOf(invoice.customer),
    subscriptionId,
    priceId: linePriceId(invoice),
    periodEnd: invoice.period_end ? new Date(invoice.period_end * 1000) : undefined,
    billingReason: invoice.billing_reason ?? undefined,
    metadataUserId:
      invoice.metadata?.userId ??
      invoice.subscription_details?.metadata?.userId ??
      invoice.parent?.subscription_details?.metadata?.userId,
  };
}

async function resolveUserId(
  deps: StripeWebhookDeps,
  context: { metadataUserId?: string; customerId?: string; subscriptionId?: string },
): Promise<string | undefined> {
  if (context.metadataUserId) return context.metadataUserId;
  if (context.customerId) {
    const byCustomer = await deps.db.getSurvielSubscriptionByCustomer(context.customerId);
    if (byCustomer?.userId) return String(byCustomer.userId);
  }
  if (context.subscriptionId) {
    try {
      const subscription = await deps.stripe.subscriptions.retrieve(context.subscriptionId);
      const userId = subscription.metadata?.userId;
      if (userId) return userId;
    } catch (error) {
      deps.logger?.warn('[Surviel] Failed to retrieve subscription metadata:', error);
    }
  }
  return undefined;
}

function isStale(subscription: ISurvielSubscription | null, eventCreated: number): boolean {
  const last = subscription?.lastEventCreatedAt;
  return last != null && eventCreated < last;
}

/**
 * Apply one verified Stripe event. Idempotent by `event.id`; tolerant of out-of-order
 * delivery by comparing `event.created` against the subscription's last applied event.
 */
export async function applyStripeEvent(options: {
  event: Stripe.Event;
  deps: StripeWebhookDeps;
}): Promise<ApplyResult> {
  const { event, deps } = options;
  const recorded = await deps.db.recordSurvielEvent({
    eventId: event.id,
    type: event.type,
    created: event.created,
  });
  if (recorded.duplicate) {
    return { handled: false, duplicate: true, reason: 'duplicate' };
  }

  const now = deps.now?.() ?? new Date();

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session;
      const userId = session.client_reference_id ?? session.metadata?.userId;
      if (!userId) return { handled: false, duplicate: false, reason: 'no-user' };
      const customerId = idOf(session.customer);
      const subscriptionId = idOf(session.subscription);
      await deps.db.upsertSurvielSubscription(
        { userId },
        {
          ...(customerId ? { stripeCustomerId: customerId } : {}),
          ...(subscriptionId ? { stripeSubscriptionId: subscriptionId } : {}),
          lastEventCreatedAt: event.created,
        },
      );
      return { handled: true, duplicate: false };
    }

    case 'invoice.paid': {
      const invoice = event.data.object as LooseInvoice;
      const context = invoiceContext(invoice);
      if (
        context.billingReason &&
        !['subscription_create', 'subscription_cycle'].includes(context.billingReason)
      ) {
        return { handled: false, duplicate: false, reason: 'billing-reason' };
      }
      const userId = await resolveUserId(deps, context);
      if (!userId) return { handled: false, duplicate: false, reason: 'no-user' };

      const existing = await deps.db.getSurvielSubscriptionByUser(userId);
      if (isStale(existing, event.created)) {
        return { handled: false, duplicate: false, reason: 'stale' };
      }

      const plan = planForPriceId(context.priceId);
      const grant = plan ? grantMicro(plan.priceMicro, deps.config.creditGrantRatio) : 0;
      const snapshot = await deps.snapshotUsage(userId);

      const { created } = await deps.db.createSurvielPeriod({
        userId,
        invoiceId: invoice.id,
        ...(plan ? { plan: plan.key } : {}),
        grantMicroUsd: grant,
        snapshotByTier: snapshot,
        periodStart: now,
        ...(context.periodEnd ? { periodEnd: context.periodEnd } : {}),
        kind: 'cycle',
      });

      if (created) {
        await deps.db.upsertSurvielSubscription(
          { userId },
          {
            status: 'active',
            flaggedForReview: false,
            graceUntil: null,
            ...(plan ? { plan: plan.key, priceId: plan.priceId } : {}),
            ...(context.customerId ? { stripeCustomerId: context.customerId } : {}),
            ...(context.subscriptionId ? { stripeSubscriptionId: context.subscriptionId } : {}),
            periodStart: now,
            ...(context.periodEnd ? { renewsAt: context.periodEnd } : {}),
            grantMicroUsd: grant,
            snapshotByTier: snapshot,
            lastEventCreatedAt: event.created,
          },
        );
      }

      await deps.provisionUser(userId);
      return { handled: true, duplicate: false };
    }

    case 'invoice.payment_failed': {
      const invoice = event.data.object as LooseInvoice;
      const context = invoiceContext(invoice);
      const userId = await resolveUserId(deps, context);
      if (!userId) return { handled: false, duplicate: false, reason: 'no-user' };
      const existing = await deps.db.getSurvielSubscriptionByUser(userId);
      if (isStale(existing, event.created)) {
        return { handled: false, duplicate: false, reason: 'stale' };
      }
      const graceUntil = new Date(now.getTime() + deps.config.graceDays * 86_400_000);
      await deps.db.upsertSurvielSubscription(
        { userId },
        { status: 'past_due', graceUntil, lastEventCreatedAt: event.created },
      );
      return { handled: true, duplicate: false };
    }

    case 'customer.subscription.updated': {
      const subscription = event.data.object as Stripe.Subscription;
      const userId = subscription.metadata?.userId;
      if (!userId) return { handled: false, duplicate: false, reason: 'no-user' };
      const existing = await deps.db.getSurvielSubscriptionByUser(userId);
      if (isStale(existing, event.created)) {
        return { handled: false, duplicate: false, reason: 'stale' };
      }
      const priceId = subscription.items?.data?.[0]?.price?.id;
      const plan = planForPriceId(priceId);
      const periodEnd = (subscription as unknown as { current_period_end?: number })
        .current_period_end;
      await deps.db.upsertSurvielSubscription(
        { userId },
        {
          ...(plan ? { plan: plan.key, priceId: plan.priceId } : {}),
          ...(periodEnd ? { renewsAt: new Date(periodEnd * 1000) } : {}),
          ...(subscription.status === 'active' ? { status: 'active' } : {}),
          lastEventCreatedAt: event.created,
        },
      );
      return { handled: true, duplicate: false };
    }

    case 'customer.subscription.deleted': {
      const subscription = event.data.object as Stripe.Subscription;
      const userId = subscription.metadata?.userId;
      if (!userId) return { handled: false, duplicate: false, reason: 'no-user' };
      const existing = await deps.db.getSurvielSubscriptionByUser(userId);
      if (isStale(existing, event.created)) {
        return { handled: false, duplicate: false, reason: 'stale' };
      }
      const periodEnd = (subscription as unknown as { current_period_end?: number })
        .current_period_end;
      await deps.db.upsertSurvielSubscription(
        { userId },
        {
          status: 'canceled',
          ...(periodEnd ? { renewsAt: new Date(periodEnd * 1000) } : {}),
          lastEventCreatedAt: event.created,
        },
      );
      // Credits stay usable until the period ends; the reconciler disables keys after.
      return { handled: true, duplicate: false };
    }

    case 'charge.refunded': {
      const charge = event.data.object as Stripe.Charge;
      const userId = await resolveUserId(deps, {
        customerId: idOf(charge.customer),
        metadataUserId: charge.metadata?.userId,
      });
      if (!userId) return { handled: false, duplicate: false, reason: 'no-user' };
      await deps.db.upsertSurvielSubscription(
        { userId },
        { status: 'review', flaggedForReview: true, lastEventCreatedAt: event.created },
      );
      await deps.disableUserKeys(userId);
      return { handled: true, duplicate: false };
    }

    case 'charge.dispute.created': {
      const dispute = event.data.object as Stripe.Dispute;
      let customerId: string | undefined;
      try {
        const chargeId = idOf(dispute.charge);
        if (chargeId) {
          const charge = await deps.stripe.charges.retrieve(chargeId);
          customerId = idOf(charge.customer);
        }
      } catch (error) {
        deps.logger?.warn('[Surviel] Failed to retrieve disputed charge:', error);
      }
      const userId = await resolveUserId(deps, { customerId });
      if (!userId) return { handled: false, duplicate: false, reason: 'no-user' };
      await deps.db.upsertSurvielSubscription(
        { userId },
        { status: 'review', flaggedForReview: true, lastEventCreatedAt: event.created },
      );
      await deps.disableUserKeys(userId);
      return { handled: true, duplicate: false };
    }

    default:
      return { handled: false, duplicate: false, reason: 'unhandled-type' };
  }
}

/** Parse a key name (`surviel:{userId}:{tier}`) into a tier number. */
function tierFromKeyName(name: string, userId: string): number | undefined {
  const prefix = openRouterKeyPrefix(userId);
  if (!name.startsWith(prefix)) return undefined;
  const tier = Number(name.slice(prefix.length));
  return Number.isInteger(tier) ? tier : undefined;
}

/** Build the default production dependencies for the webhook (env-driven). */
export function createDefaultWebhookDeps(options: {
  db: SurvielWebhookDb;
  config?: ResolvedSurvielConfig;
  stripe?: Stripe;
  logger?: SurvielWebhookLogger;
}): StripeWebhookDeps {
  const config = options.config ?? resolveSurvielConfig();
  const stripe = options.stripe ?? createStripeClient();
  const db = options.db;

  return {
    db,
    config,
    stripe,
    logger: options.logger,
    async provisionUser(userId) {
      const client = createOpenRouterClientFromEnv();
      if (!client) return;
      await provisionUserKeys({ client, db, userId, config });
    },
    async disableUserKeys(userId) {
      const client = createOpenRouterClientFromEnv();
      if (!client) return;
      await setUserKeysDisabled({ client, userId, disabled: true });
    },
    async snapshotUsage(userId) {
      const client = createOpenRouterClientFromEnv();
      if (!client) return emptyTierUsage();
      const prefix = openRouterKeyPrefix(userId);
      const keys = (await client.listAllKeys()).filter((key) => key.name.startsWith(prefix));
      const usage = { tier1: 0, tier2: 0, tier3: 0 };
      for (const key of keys) {
        const tier = tierFromKeyName(key.name, userId);
        if (tier === 1) usage.tier1 += key.usage;
        else if (tier === 2) usage.tier2 += key.usage;
        else if (tier === 3) usage.tier3 += key.usage;
      }
      return tierUsageFromUsd(usage);
    },
  };
}

/** Verify a raw webhook payload and apply the event. */
export async function handleStripeWebhook(options: {
  rawBody: Buffer | string;
  signature: string | undefined;
  deps: StripeWebhookDeps;
}): Promise<ApplyResult> {
  const secret = resolveWebhookSecret();
  if (!secret) {
    throw new SurvielError(
      SurvielErrorCodes.NOT_CONFIGURED,
      'No Stripe webhook secret configured.',
      503,
    );
  }
  if (!options.signature) {
    throw new SurvielError(
      SurvielErrorCodes.NOT_CONFIGURED,
      'Missing Stripe signature header.',
      400,
    );
  }
  const event = options.deps.stripe.webhooks.constructEvent(
    options.rawBody,
    options.signature,
    secret,
  );
  return await applyStripeEvent({ event, deps: options.deps });
}
