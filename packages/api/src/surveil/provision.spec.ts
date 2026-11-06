import type { OpenRouterApiKey, OpenRouterClient } from './openrouter/client';
import type { SurveilKeyStore } from './provision';
import { resolveSurveilConfig } from './config';
import { provisionUserKey } from './provision';

function makeClient() {
  const keys: OpenRouterApiKey[] = [];
  let counter = 0;
  const client = {
    listAllKeys: jest.fn(async () => [...keys]),
    createKey: jest.fn(
      async (input: {
        name: string;
        limit?: number | null;
        limit_reset?: 'daily' | 'weekly' | 'monthly' | null;
        expires_at?: string | null;
      }) => {
        counter += 1;
        const data: OpenRouterApiKey = {
          hash: `hash_${counter}`,
          name: input.name,
          label: `sk-or-v1-test-${counter}`,
          disabled: false,
          limit: input.limit ?? 0,
          limit_remaining: input.limit ?? 0,
          limit_reset: input.limit_reset ?? null,
          include_byok_in_limit: false,
          usage: 0,
          usage_daily: 0,
          usage_weekly: 0,
          usage_monthly: 0,
          byok_usage: 0,
          created_at: `2025-01-0${counter}T00:00:00Z`,
          updated_at: null,
          expires_at: input.expires_at ?? null,
        };
        keys.push(data);
        return { key: `sk-or-v1-test-${counter}`, data };
      },
    ),
    deleteKey: jest.fn(async (hash: string) => {
      const index = keys.findIndex((k) => k.hash === hash);
      if (index >= 0) keys.splice(index, 1);
    }),
    updateKey: jest.fn(),
  } as unknown as OpenRouterClient;
  return { client, keys };
}

function makeStore() {
  const values = new Map<string, string>();
  const db: SurveilKeyStore = {
    getUserKey: async ({ userId, name }) => {
      const value = values.get(`${userId}:${name}`);
      if (value == null) throw new Error('NO_USER_KEY');
      return value;
    },
    updateUserKey: async ({ userId, name, value }) => {
      values.set(`${userId}:${name}`, value);
    },
    deleteUserKey: async ({ userId, name }) => {
      if (name) values.delete(`${userId}:${name}`);
    },
  };
  return { db, values };
}

describe('provisionUserKey', () => {
  const config = resolveSurveilConfig({ enabled: true });
  const expiresAt = new Date('2026-02-05T00:00:00.000Z');

  it('creates one key, stores the plaintext under every tier endpoint, and sets limit/expiry', async () => {
    const { client } = makeClient();
    const { db, values } = makeStore();

    const result = await provisionUserKey({
      client,
      db,
      userId: 'user1',
      config,
      keyLimitMicroUsd: 35_500_000,
      expiresAt,
    });

    expect(result.key?.keyName).toBe('surveil:user1');
    expect(client.createKey).toHaveBeenCalledTimes(1);
    expect(client.createKey).toHaveBeenCalledWith({
      name: 'surveil:user1',
      limit: 35.5,
      limit_reset: null,
      expires_at: expiresAt.toISOString(),
    });
    for (const tier of config.tiers) {
      expect(values.get(`user1:${tier.endpoint}`)).toContain('sk-or-v1-test-1');
    }
  });

  it('does not rotate when asked to ensure an existing key', async () => {
    const { client } = makeClient();
    const { db } = makeStore();

    await provisionUserKey({
      client,
      db,
      userId: 'user1',
      config,
      keyLimitMicroUsd: 35_500_000,
      expiresAt,
    });
    await provisionUserKey({
      client,
      db,
      userId: 'user1',
      config,
      keyLimitMicroUsd: 35_500_000,
      expiresAt,
      rotate: false,
    });

    expect(client.createKey).toHaveBeenCalledTimes(1);
  });

  it('rotates a new period and deletes the previous key', async () => {
    const { client } = makeClient();
    const { db } = makeStore();

    await provisionUserKey({
      client,
      db,
      userId: 'user1',
      config,
      keyLimitMicroUsd: 35_500_000,
      expiresAt,
    });
    const second = await provisionUserKey({
      client,
      db,
      userId: 'user1',
      config,
      keyLimitMicroUsd: 71_300_000,
      expiresAt: new Date('2026-03-05T00:00:00.000Z'),
    });

    expect(second.key?.created).toBe(true);
    expect(second.key?.rotated).toBe(true);
    expect(client.createKey).toHaveBeenCalledTimes(2);
    expect(client.deleteKey).toHaveBeenCalledTimes(1);
  });

  it('rotates a remote key whose plaintext is missing from the store', async () => {
    const { client, keys } = makeClient();
    const { db } = makeStore();

    await provisionUserKey({
      client,
      db,
      userId: 'user1',
      config,
      keyLimitMicroUsd: 35_500_000,
      expiresAt,
    });
    const { db: emptyDb } = makeStore();

    await provisionUserKey({
      client,
      db: emptyDb,
      userId: 'user1',
      config,
      keyLimitMicroUsd: 35_500_000,
      expiresAt,
      rotate: false,
    });

    expect(client.deleteKey).toHaveBeenCalledTimes(1);
    expect(client.createKey).toHaveBeenCalledTimes(2);
    expect(keys).toHaveLength(1);
  });
});
