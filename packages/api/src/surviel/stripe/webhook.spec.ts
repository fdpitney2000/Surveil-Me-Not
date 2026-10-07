import type Stripe from 'stripe';
import type { StripeWebhookDeps, SurvielWebhookDb } from './webhook';
import { applyStripeEvent, handleStripeWebhook } from './webhook';
import { resolveSurvielConfig } from '../config';
import { SurvielErrorCodes } from '../errors';

const PRICE_100 = 'price_100_test';

function makeDb() {
  const subs = new Map<string, Record<string, unknown>>();
  const periods: Array<Record<string, unknown>> = [];
  const events = new Set<string>();
  const db = {
    async recordSurvielEvent({ eventId }: { eventId: string }) {
      if (events.has(eventId)) return { duplicate: true };
      events.add(eventId);
      return { duplicate: false };
    },
    async getSurvielSubscriptionByUser(userId: string) {
      return subs.get(userId) ?? null;
    },
    async getSurvielSubscriptionByCustomer(customerId: string) {
      return [...subs.values()].find((s) => s.stripeCustomerId === customerId) ?? null;
    },
    async upsertSurvielSubscription(
      filter: Record<string, unknown>,
      update: Record<string, unknown>,
    ) {
      const userId = String(filter.userId);
      const next = { ...(subs.get(userId) ?? { userId }), ...update };
      subs.set(userId, next);
      return next;
    },
    async createSurvielPeriod(input: Record<string, unknown>) {
      if (periods.some((p) => p.invoiceId === input.invoiceId)) return { created: false };
      periods.push(input);
      return { created: true };
    },
    async getUserKey() {
      throw new Error('no key');
    },
    async updateUserKey() {},
    async deleteUserKey() {},
  };
  return { db: db as unknown as SurvielWebhookDb, subs, periods, events };
}

function makeStripe() {
  return {
    webhooks: {
      constructEvent: jest.fn((body: Buffer | string) => JSON.parse(String(body))),
    },
    subscriptions: { retrieve: jest.fn(async () => ({ metadata: { userId: 'u1' } })) },
    charges: { retrieve: jest.fn(async () => ({ customer: 'cus_1' })) },
  } as unknown as Stripe;
}

function invoiceEvent(overrides: Record<string, unknown> = {}): Stripe.Event {
  return {
    id: 'evt_invoice',
    type: 'invoice.paid',
    created: 1000,
    data: {
      object: {
        id: 'in_1',
        object: 'invoice',
        customer: 'cus_1',
        subscription: 'sub_1',
        billing_reason: 'subscription_create',
        period_end: 2000,
        metadata: { userId: 'u1' },
        lines: { data: [{ price: { id: PRICE_100 } }] },
        ...overrides,
      },
    },
  } as unknown as Stripe.Event;
}

function makeDeps(db: SurvielWebhookDb, stripe: Stripe): StripeWebhookDeps {
  return {
    db,
    config: resolveSurvielConfig({ enabled: true, graceDays: 3 }),
    stripe,
    provisionUser: jest.fn(async () => {}),
    disableUserKeys: jest.fn(async () => {}),
    snapshotUsage: jest.fn(async () => ({ tier1: 0, tier2: 0, tier3: 0 })),
    now: () => new Date('2025-06-01T00:00:00Z'),
  };
}

describe('applyStripeEvent – invoice.paid', () => {
  beforeAll(() => {
    process.env.STRIPE_PRICE_100_ID = PRICE_100;
  });

  it('starts a period, grants 90% of the price, and provisions keys', async () => {
    const { db, periods, subs } = makeDb();
    const stripe = makeStripe();
    const deps = makeDeps(db, stripe);

    const result = await applyStripeEvent({ event: invoiceEvent(), deps });

    expect(result.handled).toBe(true);
    expect(periods).toHaveLength(1);
    expect(periods[0].grantMicroUsd).toBe(90_000_000);
    expect(subs.get('u1')?.grantMicroUsd).toBe(90_000_000);
    expect(subs.get('u1')?.status).toBe('active');
    expect(deps.provisionUser).toHaveBeenCalledWith('u1');
  });

  it('ignores a duplicate event id', async () => {
    const { db, periods } = makeDb();
    const deps = makeDeps(db, makeStripe());
    await applyStripeEvent({ event: invoiceEvent(), deps });
    const second = await applyStripeEvent({ event: invoiceEvent(), deps });
    expect(second.duplicate).toBe(true);
    expect(periods).toHaveLength(1);
  });

  it('tolerates out-of-order delivery by event.created', async () => {
    const { db, periods, subs } = makeDb();
    subs.set('u1', { userId: 'u1', lastEventCreatedAt: 2000 });
    const deps = makeDeps(db, makeStripe());

    const result = await applyStripeEvent({ event: invoiceEvent(), deps });
    expect(result.reason).toBe('stale');
    expect(periods).toHaveLength(0);
  });

  it('ignores non-subscription billing reasons', async () => {
    const { db } = makeDb();
    const deps = makeDeps(db, makeStripe());
    const result = await applyStripeEvent({
      event: invoiceEvent({ billing_reason: 'manual' }),
      deps,
    });
    expect(result.reason).toBe('billing-reason');
  });
});

describe('applyStripeEvent – lifecycle', () => {
  it('sets past_due with a grace period on payment failure', async () => {
    const { db, subs } = makeDb();
    subs.set('u1', { userId: 'u1', stripeCustomerId: 'cus_1', status: 'active' });
    const deps = makeDeps(db, makeStripe());

    await applyStripeEvent({
      event: {
        id: 'evt_fail',
        type: 'invoice.payment_failed',
        created: 1000,
        data: { object: { id: 'in_2', customer: 'cus_1', metadata: { userId: 'u1' } } },
      } as unknown as Stripe.Event,
      deps,
    });

    expect(subs.get('u1')?.status).toBe('past_due');
    expect(subs.get('u1')?.graceUntil).toEqual(new Date('2025-06-04T00:00:00Z'));
  });

  it('marks canceled on subscription deletion without disabling keys immediately', async () => {
    const { db, subs } = makeDb();
    subs.set('u1', { userId: 'u1', status: 'active' });
    const deps = makeDeps(db, makeStripe());

    await applyStripeEvent({
      event: {
        id: 'evt_del',
        type: 'customer.subscription.deleted',
        created: 1000,
        data: {
          object: {
            id: 'sub_1',
            metadata: { userId: 'u1' },
            current_period_end: 5000,
            items: { data: [{ price: { id: PRICE_100 } }] },
          },
        },
      } as unknown as Stripe.Event,
      deps,
    });

    expect(subs.get('u1')?.status).toBe('canceled');
    expect(deps.disableUserKeys).not.toHaveBeenCalled();
  });

  it('flags review and disables keys on refund', async () => {
    const { db, subs } = makeDb();
    subs.set('u1', { userId: 'u1', stripeCustomerId: 'cus_1', status: 'active' });
    const deps = makeDeps(db, makeStripe());

    await applyStripeEvent({
      event: {
        id: 'evt_refund',
        type: 'charge.refunded',
        created: 1000,
        data: { object: { id: 'ch_1', customer: 'cus_1', metadata: {} } },
      } as unknown as Stripe.Event,
      deps,
    });

    expect(subs.get('u1')?.status).toBe('review');
    expect(subs.get('u1')?.flaggedForReview).toBe(true);
    expect(deps.disableUserKeys).toHaveBeenCalledWith('u1');
  });
});

describe('handleStripeWebhook – signature verification', () => {
  const original = { ...process.env };
  afterEach(() => {
    process.env = { ...original };
  });

  it('throws when no webhook secret is configured', async () => {
    process.env.SURVIEL_STRIPE_WEBHOOK_SOURCE = 'cli';
    delete process.env.STRIPE_WEBHOOK_SECRET_LOCAL;
    delete process.env.STRIPE_WEBHOOK_SECRET;
    const { db } = makeDb();
    await expect(
      handleStripeWebhook({ rawBody: '{}', signature: 'sig', deps: makeDeps(db, makeStripe()) }),
    ).rejects.toMatchObject({ code: SurvielErrorCodes.NOT_CONFIGURED });
  });

  it('requires a signature header', async () => {
    process.env.STRIPE_WEBHOOK_SECRET_LOCAL = 'whsec_test';
    const { db } = makeDb();
    await expect(
      handleStripeWebhook({
        rawBody: '{}',
        signature: undefined,
        deps: makeDeps(db, makeStripe()),
      }),
    ).rejects.toMatchObject({ code: SurvielErrorCodes.NOT_CONFIGURED });
  });

  it('verifies and applies a valid event', async () => {
    process.env.STRIPE_WEBHOOK_SECRET_LOCAL = 'whsec_test';
    process.env.STRIPE_PRICE_100_ID = PRICE_100;
    const { db, periods } = makeDb();
    const stripe = makeStripe();
    const deps = makeDeps(db, stripe);

    const result = await handleStripeWebhook({
      rawBody: JSON.stringify(invoiceEvent()),
      signature: 'sig_valid',
      deps,
    });

    expect(result.handled).toBe(true);
    expect(periods).toHaveLength(1);
    expect(stripe.webhooks.constructEvent).toHaveBeenCalledWith(
      expect.anything(),
      'sig_valid',
      'whsec_test',
    );
  });
});
