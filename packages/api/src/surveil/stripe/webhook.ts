import type { ISurveilSubscription } from '@librechat/data-schemas';
import type Stripe from 'stripe';
import type { ResolvedSurveilConfig } from '../config';
import type { SurveilKeyStore } from '../provision';
import { resolveSurveilConfig } from '../config';
import { provisionUserKey, setUserKeysDisabled } from '../provision';
import { createOpenRouterClientFromEnv } from '../openrouter/client';
import { createStripeClient, resolveWebhookSecret } from './client';
import { SurveilError, SurveilErrorCodes } from '../errors';
import { planForPriceId } from '../plans';
import { netProceedsMicro } from '../money';

/** The database methods the webhook needs (a subset of the aggregated methods). */
export interface SurveilWebhookDb extends SurveilKeyStore {
  getSurveilSubscriptionByUser: (userId: string) => Promise<ISurveilSubscription | null>;
  getSurveilSubscriptionByCustomer: (customerId: string) => Promise<ISurveilSubscription | null>;
  upsertSurveilSubscription: (
    filter: Record<string, unknown>,
    update: Partial<ISurveilSubscription>,
  ) => Promise<ISurveilSubscription | null>;
  createSurveilPeriod: (input: {
    userId: string;
    invoiceId: string;
    plan?: string | undefined;
    grantMicroUsd: number;
    snapshotUsageMicro: number;
    periodStart?: Date | undefined;
    periodEnd?: Date | undefined;
    kind?: 'cycle' | 'proration' | undefined;
  }) => Promise<{ created: boolean }>;
  recordSurveilEvent: (input: {
    eventId: string;
    type: string;
    created: number;
    status?: 'processed' | 'ignored' | 'error';
    note?: string;
  }) => Promise<{ duplicate: boolean }>;
}

export interface SurveilWebhookLogger {
  warn: (...args: unknown[]) => void;
  info?: (...args: unknown[]) => void;
}

export interface StripeWebhookDeps {
  db: SurveilWebhookDb;
  config: ResolvedSurveilConfig;
  stripe: Stripe;
  provisionUser: (
    userId: string,
    options: { keyLimitMicroUsd: number; expiresAt?: Date; rotate: boolean },
  ) => Promise<void>;
  disableUserKeys: (userId: string) => Promise<void>;
  now?: () => Date;
  logger?: SurveilWebhookLogger;
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
  period?: { start?: number; end?: number } | null;
};

/** The price id on the first invoice line, tolerating both Stripe API shapes. */
function linePriceId(invoice: LooseInvoice): string | undefined {
  const line = invoice.lines?.data?.[0] as LooseInvoiceLine | undefined;
  return line?.price?.id ?? line?.pricing?.price_details?.price;
}

/**
 * The service period end on the first invoice line. On newer Stripe API versions the
 * invoice's own `period_start`/`period_end` collapse to the creation instant on
 * subscription invoices, while the line item still carries the real billing cycle.
 */
function linePeriodEnd(invoice: LooseInvoice): Date | undefined {
  const line = invoice.lines?.data?.[0] as LooseInvoiceLine | undefined;
  const end = line?.period?.end;
  return typeof end === 'number' ? new Date(end * 1000) : undefined;
}

function invoiceContext(invoice: LooseInvoice): InvoiceContext {
  const subscriptionId =
    idOf(invoice.subscription) ?? idOf(invoice.parent?.subscription_details?.subscription);
  return {
    customerId: idOf(invoice.customer),
    subscriptionId,
    priceId: linePriceId(invoice),
    periodEnd:
      linePeriodEnd(invoice) ??
      (invoice.period_end ? new Date(invoice.period_end * 1000) : undefined),
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
    const byCustomer = await deps.db.getSurveilSubscriptionByCustomer(context.customerId);
    if (byCustomer?.userId) return String(byCustomer.userId);
  }
  if (context.subscriptionId) {
    try {
      const subscription = await deps.stripe.subscriptions.retrieve(context.subscriptionId);
      const userId = subscription.metadata?.userId;
      if (userId) return userId;
    } catch (error) {
      deps.logger?.warn('[Surveil] Failed to retrieve subscription metadata:', error);
    }
  }
  return undefined;
}

function isStale(subscription: ISurveilSubscription | null, eventCreated: number): boolean {
  const last = subscription?.lastEventCreatedAt;
  return last != null && eventCreated < last;
}

/**
 * Renewal instant for a subscription. Newer Stripe API versions moved
 * `current_period_end` from the subscription top level onto its items.
 */
function subscriptionPeriodEnd(subscription: Stripe.Subscription): Date | undefined {
  const itemEnd = subscription.items?.data?.[0]?.current_period_end;
  const topLevel = (subscription as unknown as { current_period_end?: number }).current_period_end;
  const end = itemEnd ?? topLevel;
  return typeof end === 'number' ? new Date(end * 1000) : undefined;
}

/** Next monthly anniversary in UTC, clamping to the last valid day of the month. */
export function nextMonthlyAnniversary(from: Date): Date {
  const day = from.getUTCDate();
  const next = new Date(from.getTime());
  next.setUTCMonth(next.getUTCMonth() + 1, 1);
  const lastDay = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0)).getUTCDate();
  next.setUTCDate(Math.min(day, lastDay));
  return next;
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
  const recorded = await deps.db.recordSurveilEvent({
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
      await deps.db.upsertSurveilSubscription(
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

      const existing = await deps.db.getSurveilSubscriptionByUser(userId);
      if (isStale(existing, event.created)) {
        return { handled: false, duplicate: false, reason: 'stale' };
      }

      const plan = planForPriceId(context.priceId);
      if (!plan) {
        deps.logger?.warn('[Surveil] invoice.paid for an unknown price:', context.priceId);
        return { handled: false, duplicate: false, reason: 'unknown-plan' };
      }

      const keyLimitMicroUsd = netProceedsMicro(plan.priceMicro, {
        retentionPct: deps.config.retentionPct,
        stripeFeePct: deps.config.stripeFeePct,
        stripeFeeFixedUsd: deps.config.stripeFeeFixedUsd,
        openrouterFeePct: deps.config.openrouterFeePct,
      });
      const periodEnd = context.periodEnd ?? nextMonthlyAnniversary(now);

      const { created } = await deps.db.createSurveilPeriod({
        userId,
        invoiceId: invoice.id,
        plan: plan.key,
        grantMicroUsd: keyLimitMicroUsd,
        snapshotUsageMicro: 0,
        periodStart: now,
        periodEnd,
        kind: 'cycle',
      });

      if (created) {
        await deps.db.upsertSurveilSubscription(
          { userId },
          {
            status: 'active',
            flaggedForReview: false,
            graceUntil: null,
            plan: plan.key,
            priceId: plan.priceId,
            ...(context.customerId ? { stripeCustomerId: context.customerId } : {}),
            ...(context.subscriptionId ? { stripeSubscriptionId: context.subscriptionId } : {}),
            periodStart: now,
            renewsAt: periodEnd,
            grantMicroUsd: keyLimitMicroUsd,
            snapshotUsageMicro: 0,
            usageMicro: 0,
            keyExpiresAt: periodEnd,
            keyLimitMicroUsd,
            lastEventCreatedAt: event.created,
          },
        );
      }

      await deps.provisionUser(userId, {
        keyLimitMicroUsd,
        expiresAt: periodEnd,
        rotate: created,
      });
      return { handled: true, duplicate: false };
    }

    case 'invoice.payment_failed': {
      const invoice = event.data.object as LooseInvoice;
      const context = invoiceContext(invoice);
      const userId = await resolveUserId(deps, context);
      if (!userId) return { handled: false, duplicate: false, reason: 'no-user' };
      const existing = await deps.db.getSurveilSubscriptionByUser(userId);
      if (isStale(existing, event.created)) {
        return { handled: false, duplicate: false, reason: 'stale' };
      }
      const graceUntil = new Date(now.getTime() + deps.config.graceDays * 86_400_000);
      await deps.db.upsertSurveilSubscription(
        { userId },
        { status: 'past_due', graceUntil, lastEventCreatedAt: event.created },
      );
      return { handled: true, duplicate: false };
    }

    case 'customer.subscription.updated': {
      const subscription = event.data.object as Stripe.Subscription;
      const userId = subscription.metadata?.userId;
      if (!userId) return { handled: false, duplicate: false, reason: 'no-user' };
      const existing = await deps.db.getSurveilSubscriptionByUser(userId);
      if (isStale(existing, event.created)) {
        return { handled: false, duplicate: false, reason: 'stale' };
      }
      const priceId = subscription.items?.data?.[0]?.price?.id;
      const plan = planForPriceId(priceId);
      const periodEnd = subscriptionPeriodEnd(subscription);
      await deps.db.upsertSurveilSubscription(
        { userId },
        {
          ...(plan ? { plan: plan.key, priceId: plan.priceId } : {}),
          ...(periodEnd ? { renewsAt: periodEnd } : {}),
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
      const existing = await deps.db.getSurveilSubscriptionByUser(userId);
      if (isStale(existing, event.created)) {
        return { handled: false, duplicate: false, reason: 'stale' };
      }
      const periodEnd = subscriptionPeriodEnd(subscription);
      await deps.db.upsertSurveilSubscription(
        { userId },
        {
          status: 'canceled',
          ...(periodEnd ? { renewsAt: periodEnd } : {}),
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
      await deps.db.upsertSurveilSubscription(
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
        deps.logger?.warn('[Surveil] Failed to retrieve disputed charge:', error);
      }
      const userId = await resolveUserId(deps, { customerId });
      if (!userId) return { handled: false, duplicate: false, reason: 'no-user' };
      await deps.db.upsertSurveilSubscription(
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

/** Build the default production dependencies for the webhook (env-driven). */
export function createDefaultWebhookDeps(options: {
  db: SurveilWebhookDb;
  config?: ResolvedSurveilConfig;
  stripe?: Stripe;
  logger?: SurveilWebhookLogger;
}): StripeWebhookDeps {
  const config = options.config ?? resolveSurveilConfig();
  const stripe = options.stripe ?? createStripeClient();
  const db = options.db;

  return {
    db,
    config,
    stripe,
    logger: options.logger,
    async provisionUser(userId, provisionOptions) {
      const client = createOpenRouterClientFromEnv();
      if (!client) return;
      await provisionUserKey({
        client,
        db,
        userId,
        config,
        keyLimitMicroUsd: provisionOptions.keyLimitMicroUsd,
        expiresAt: provisionOptions.expiresAt ?? null,
        rotate: provisionOptions.rotate,
      });
    },
    async disableUserKeys(userId) {
      const client = createOpenRouterClientFromEnv();
      if (!client) return;
      await setUserKeysDisabled({ client, userId, disabled: true });
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
    throw new SurveilError(
      SurveilErrorCodes.NOT_CONFIGURED,
      'No Stripe webhook secret configured.',
      503,
    );
  }
  if (!options.signature) {
    throw new SurveilError(
      SurveilErrorCodes.NOT_CONFIGURED,
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
