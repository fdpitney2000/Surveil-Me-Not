import type { ISurvielSubscription } from '@librechat/data-schemas';
import type { OpenRouterClient } from './openrouter/client';
import type { SurvielReconcileDb } from './reconciler';
import { chooseActiveTier, isSubscriptionUsable, reconcileSubscription } from './reconciler';
import { resolveSurvielConfig } from './config';
import { usdToMicro } from './money';

function makeSubscription(overrides: Partial<ISurvielSubscription> = {}): ISurvielSubscription {
  return {
    userId: 'u1',
    status: 'active',
    grantMicroUsd: usdToMicro(10),
    snapshotByTier: { tier1: 0, tier2: 0, tier3: 0 },
    usageByTier: { tier1: 0, tier2: 0, tier3: 0 },
    activeTier: 1,
    flaggedForReview: false,
    ...overrides,
  } as unknown as ISurvielSubscription;
}

function makeClient(usages: Record<number, number>, disabled: Record<number, boolean> = {}) {
  const updates: Array<{ hash: string; body: Record<string, unknown> }> = [];
  const keys = [1, 2, 3].map((tier) => ({
    hash: `h${tier}`,
    name: `surviel:u1:${tier}`,
    usage: usages[tier] ?? 0,
    disabled: disabled[tier] ?? false,
  }));
  const client = {
    listAllKeys: jest.fn(async () => keys),
    updateKey: jest.fn(async (hash: string, body: Record<string, unknown>) => {
      updates.push({ hash, body });
    }),
  } as unknown as OpenRouterClient;
  return { client, updates };
}

function makeDb() {
  let saved: Partial<ISurvielSubscription> = {};
  const db = {
    getSurvielSubscriptionByUser: jest.fn(async () => null),
    listSurvielSubscriptions: jest.fn(async () => []),
    upsertSurvielSubscription: jest.fn(async (_filter, update) => {
      saved = update;
      return null;
    }),
  } as unknown as SurvielReconcileDb;
  return { db, getSaved: () => saved };
}

const config = resolveSurvielConfig({ enabled: true, keyLimitMode: 'allocate' });

describe('isSubscriptionUsable', () => {
  const now = new Date('2025-06-01T00:00:00Z');
  it('allows active', () => {
    expect(isSubscriptionUsable(makeSubscription({ status: 'active' }), now)).toBe(true);
  });
  it('allows past_due within grace', () => {
    expect(
      isSubscriptionUsable(
        makeSubscription({ status: 'past_due', graceUntil: new Date('2025-06-02T00:00:00Z') }),
        now,
      ),
    ).toBe(true);
  });
  it('rejects past_due after grace', () => {
    expect(
      isSubscriptionUsable(
        makeSubscription({ status: 'past_due', graceUntil: new Date('2025-05-30T00:00:00Z') }),
        now,
      ),
    ).toBe(false);
  });
  it('allows canceled until period end, then rejects', () => {
    expect(
      isSubscriptionUsable(
        makeSubscription({ status: 'canceled', renewsAt: new Date('2025-06-10T00:00:00Z') }),
        now,
      ),
    ).toBe(true);
    expect(
      isSubscriptionUsable(
        makeSubscription({ status: 'canceled', renewsAt: new Date('2025-05-10T00:00:00Z') }),
        now,
      ),
    ).toBe(false);
  });
  it('rejects review and disabled', () => {
    expect(isSubscriptionUsable(makeSubscription({ status: 'review' }), now)).toBe(false);
    expect(isSubscriptionUsable(makeSubscription({ status: 'disabled' }), now)).toBe(false);
  });
});

describe('chooseActiveTier', () => {
  it('picks the tier with the largest usage increase', () => {
    const subscription = makeSubscription({
      activeTier: 1,
      usageByTier: { tier1: 1_000_000, tier2: 0, tier3: 0 },
    });
    const tier = chooseActiveTier(subscription, { tier1: 1_100_000, tier2: 0, tier3: 5_000_000 });
    expect(tier).toBe(3);
  });
});

describe('reconcileSubscription – allocate mode', () => {
  it('gives the pool to the active tier and a reserve to others', async () => {
    const { db } = makeDb();
    const { client, updates } = makeClient({ 1: 1, 2: 0, 3: 0 });
    const subscription = makeSubscription({ grantMicroUsd: usdToMicro(10) });

    await reconcileSubscription({ db, client, config, subscription });

    const byHash = new Map(updates.map((u) => [u.hash, u.body]));
    expect(byHash.get('h1')?.limit).toBeCloseTo(10); // 1 used + 9 remaining
    expect(byHash.get('h2')?.limit).toBeCloseTo(5); // reserve = lowBalanceThresholdUsd
    expect(byHash.get('h3')?.limit).toBeCloseTo(5);
    expect(updates.some((u) => u.hash === 'h1' && u.body.disabled === true)).toBe(false);
  });

  it('disables all keys when credits are exhausted', async () => {
    const { db } = makeDb();
    const { client, updates } = makeClient({ 1: 10, 2: 0, 3: 0 });
    const subscription = makeSubscription({ grantMicroUsd: usdToMicro(10) });

    const summary = await reconcileSubscription({ db, client, config, subscription });

    expect(summary.disabled).toBe(true);
    expect(updates.every((u) => u.body.disabled === true)).toBe(true);
  });

  it('disables all keys for a review status', async () => {
    const { db } = makeDb();
    const { client, updates } = makeClient({ 1: 0, 2: 0, 3: 0 });
    const subscription = makeSubscription({ status: 'review', flaggedForReview: true });

    await reconcileSubscription({ db, client, config, subscription });
    expect(updates.every((u) => u.body.disabled === true)).toBe(true);
  });

  it('re-enables keys and persists usage after a renewal', async () => {
    const { db, getSaved } = makeDb();
    const { client, updates } = makeClient({ 1: 0, 2: 0, 3: 0 }, { 1: true, 2: true, 3: true });
    const subscription = makeSubscription();

    await reconcileSubscription({ db, client, config, subscription });

    expect(updates.some((u) => u.body.disabled === false)).toBe(true);
    expect(getSaved().usageByTier).toEqual({ tier1: 0, tier2: 0, tier3: 0 });
    expect(getSaved().lastSyncedAt).toBeInstanceOf(Date);
  });
});
