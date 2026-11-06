import type { ISurveilSubscription } from '@librechat/data-schemas';
import type { OpenRouterClient } from './openrouter/client';
import type { SurveilReconcileDb } from './reconciler';
import { isSubscriptionUsable, reconcileSubscription } from './reconciler';
import { resolveSurveilConfig } from './config';
import { usdToMicro } from './money';

function makeSubscription(overrides: Partial<ISurveilSubscription> = {}): ISurveilSubscription {
  return {
    userId: 'u1',
    status: 'active',
    grantMicroUsd: usdToMicro(10),
    snapshotUsageMicro: 0,
    usageMicro: 0,
    flaggedForReview: false,
    ...overrides,
  } as unknown as ISurveilSubscription;
}

function makeClient(
  keys: Array<{ hash: string; name: string; usage: number; disabled?: boolean; createdAt?: string }>,
) {
  const updates: Array<{ hash: string; body: Record<string, unknown> }> = [];
  const all = keys.map((key, index) => ({
    hash: key.hash,
    name: key.name,
    usage: key.usage,
    disabled: key.disabled ?? false,
    created_at: key.createdAt ?? `2025-01-0${index + 1}T00:00:00Z`,
    expires_at: null,
    label: '',
    limit: null,
    limit_remaining: null,
    limit_reset: null,
    include_byok_in_limit: false,
    usage_daily: 0,
    usage_weekly: 0,
    usage_monthly: 0,
    byok_usage: 0,
    updated_at: null,
  }));
  const client = {
    listAllKeys: jest.fn(async () => all),
    updateKey: jest.fn(async (hash: string, body: Record<string, unknown>) => {
      updates.push({ hash, body });
    }),
  } as unknown as OpenRouterClient;
  return { client, updates };
}

function makeDb() {
  let saved: Partial<ISurveilSubscription> = {};
  const db = {
    getSurveilSubscriptionByUser: jest.fn(async () => null),
    listSurveilSubscriptions: jest.fn(async () => []),
    upsertSurveilSubscription: jest.fn(async (_filter, update) => {
      saved = update;
      return null;
    }),
  } as unknown as SurveilReconcileDb;
  return { db, getSaved: () => saved };
}

const config = resolveSurveilConfig({ enabled: true });

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

describe('reconcileSubscription – single key', () => {
  it('sets the current key limit to usage plus remaining and keeps it enabled', async () => {
    const { db } = makeDb();
    const { client, updates } = makeClient([
      { hash: 'h1', name: 'surveil:u1', usage: 1 },
    ]);
    const subscription = makeSubscription({ grantMicroUsd: usdToMicro(10) });

    await reconcileSubscription({ db, client, config, subscription });

    expect(updates).toContainEqual({ hash: 'h1', body: { limit: 10 } });
    expect(updates.some((u) => u.hash === 'h1' && u.body.disabled === true)).toBe(false);
  });

  it('disables the key when credits are exhausted', async () => {
    const { db } = makeDb();
    const { client, updates } = makeClient([
      { hash: 'h1', name: 'surveil:u1', usage: 10 },
    ]);
    const subscription = makeSubscription({ grantMicroUsd: usdToMicro(10) });

    const summary = await reconcileSubscription({ db, client, config, subscription });

    expect(summary.disabled).toBe(true);
    expect(updates).toContainEqual({ hash: 'h1', body: { disabled: true } });
  });

  it('disables the key for a review status', async () => {
    const { db } = makeDb();
    const { client, updates } = makeClient([
      { hash: 'h1', name: 'surveil:u1', usage: 0 },
    ]);
    const subscription = makeSubscription({ status: 'review', flaggedForReview: true });

    await reconcileSubscription({ db, client, config, subscription });
    expect(updates).toContainEqual({ hash: 'h1', body: { disabled: true } });
  });

  it('re-enables the key and persists usage after a renewal', async () => {
    const { db, getSaved } = makeDb();
    const { client, updates } = makeClient([
      { hash: 'h1', name: 'surveil:u1', usage: 0, disabled: true },
    ]);
    const subscription = makeSubscription();

    await reconcileSubscription({ db, client, config, subscription });

    expect(updates).toContainEqual({ hash: 'h1', body: { disabled: false } });
    expect(updates).toContainEqual({ hash: 'h1', body: { limit: 10 } });
    expect(getSaved().usageMicro).toBe(0);
    expect(getSaved().lastSyncedAt).toBeInstanceOf(Date);
  });

  it('disables legacy per-tier keys and only counts the current key', async () => {
    const { db } = makeDb();
    const { client, updates } = makeClient([
      { hash: 'h1', name: 'surveil:u1', usage: 1, createdAt: '2025-02-01T00:00:00Z' },
      { hash: 'legacy', name: 'surveil:u1:2', usage: 5, createdAt: '2025-01-01T00:00:00Z' },
    ]);
    const subscription = makeSubscription({ grantMicroUsd: usdToMicro(10) });

    await reconcileSubscription({ db, client, config, subscription });

    expect(updates).toContainEqual({ hash: 'legacy', body: { disabled: true } });
    expect(updates).toContainEqual({ hash: 'h1', body: { limit: 10 } });
  });
});
