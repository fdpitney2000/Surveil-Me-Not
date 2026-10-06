import type { OpenRouterApiKey, OpenRouterClient, OpenRouterGuardrail } from './openrouter/client';
import type { SurvielKeyStore } from './provision';
import { resolveSurvielConfig } from './config';
import { provisionUserKeys } from './provision';

function guardrails(): OpenRouterGuardrail[] {
  return [1, 2, 3].map((tier) => ({
    id: `grd_${tier}`,
    name: `surviel:tier${tier}`,
    limit_usd: 180,
    reset_interval: 'monthly' as const,
  }));
}

function makeClient() {
  const keys: OpenRouterApiKey[] = [];
  let counter = 0;
  const assigned: Array<{ guardrailId: string; hashes: string[] }> = [];
  const client = {
    listGuardrails: jest.fn(async () => guardrails()),
    listAllKeys: jest.fn(async () => [...keys]),
    listKeys: jest.fn(async () => [...keys]),
    createKey: jest.fn(async ({ name }: { name: string }) => {
      counter += 1;
      const data: OpenRouterApiKey = {
        hash: `hash_${counter}`,
        name,
        label: `sk-or-v1-...${counter}`,
        disabled: false,
        limit: 0,
        limit_remaining: 0,
        limit_reset: null,
        include_byok_in_limit: false,
        usage: 0,
        usage_daily: 0,
        usage_weekly: 0,
        usage_monthly: 0,
        byok_usage: 0,
        created_at: '2025-01-01T00:00:00Z',
        updated_at: null,
      };
      keys.push(data);
      return { key: `sk-or-v1-plaintext-${counter}`, data };
    }),
    deleteKey: jest.fn(async (hash: string) => {
      const index = keys.findIndex((k) => k.hash === hash);
      if (index >= 0) keys.splice(index, 1);
    }),
    assignKeysToGuardrail: jest.fn(async (guardrailId: string, hashes: string[]) => {
      assigned.push({ guardrailId, hashes });
      return hashes.length;
    }),
  } as unknown as OpenRouterClient;
  return { client, keys, assigned };
}

function makeStore() {
  const values = new Map<string, string>();
  const db: SurvielKeyStore = {
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

describe('provisionUserKeys', () => {
  const config = resolveSurvielConfig({ enabled: true });

  it('creates one key per tier, stores the plaintext, and assigns guardrails', async () => {
    const { client, assigned } = makeClient();
    const { db, values } = makeStore();

    const result = await provisionUserKeys({ client, db, userId: 'user1', config });

    expect(result.tiers).toHaveLength(3);
    expect(client.createKey).toHaveBeenCalledTimes(3);
    expect(assigned).toHaveLength(3);
    expect(assigned.map((a) => a.guardrailId).sort()).toEqual(['grd_1', 'grd_2', 'grd_3']);
    expect(values.get('user1:Enterprise Vault')).toContain('sk-or-v1-plaintext');
  });

  it('is idempotent: a second run creates nothing', async () => {
    const { client } = makeClient();
    const { db } = makeStore();

    await provisionUserKeys({ client, db, userId: 'user1', config });
    await provisionUserKeys({ client, db, userId: 'user1', config });

    expect(client.createKey).toHaveBeenCalledTimes(3);
  });

  it('rotates a remote key whose plaintext is missing from the store', async () => {
    const { client, keys } = makeClient();
    const { db } = makeStore();

    await provisionUserKeys({ client, db, userId: 'user1', config });
    // Simulate a lost encrypted store: clear it while remote keys remain.
    const { db: emptyDb } = makeStore();

    await provisionUserKeys({ client, db: emptyDb, userId: 'user1', config });

    expect(client.deleteKey).toHaveBeenCalledTimes(3);
    expect(client.createKey).toHaveBeenCalledTimes(6);
    expect(keys).toHaveLength(3);
  });
});
