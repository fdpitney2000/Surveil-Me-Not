import type { OpenRouterApiKey, OpenRouterClient, OpenRouterGuardrail } from './openrouter/client';
import type { SurvielKeyStore } from './provision';
import { provisionUserOnRegistration } from './registration';

function guardrails(): OpenRouterGuardrail[] {
  return [1, 2, 3].map((tier) => ({
    id: `grd_${tier}`,
    name: `surviel:tier${tier}`,
    limit_usd: 180,
    reset_interval: 'monthly' as const,
  }));
}

function makeClient(failOn?: 'createKey') {
  const keys: OpenRouterApiKey[] = [];
  let counter = 0;
  const assigned: Array<{ guardrailId: string; hashes: string[] }> = [];
  const client = {
    listGuardrails: jest.fn(async () => guardrails()),
    listAllKeys: jest.fn(async () => [...keys]),
    listKeys: jest.fn(async () => [...keys]),
    createKey: jest.fn(async ({ name }: { name: string }) => {
      if (failOn === 'createKey') {
        throw new Error('OpenRouter unreachable');
      }
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
      return { key: `sk-or-...ext-${counter}`, data };
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

describe('provisionUserOnRegistration', () => {
  const userId = 'user_abc123';

  it('provisions one limit-0 key per tier and stores them encrypted', async () => {
    const { client, keys, assigned } = makeClient();
    const { db, values } = makeStore();
    const result = await provisionUserOnRegistration({
      db,
      userId,
      client,
      rawConfig: { enabled: true, provisionOnRegistration: true },
    });
    expect(result).toEqual({ provisioned: true, skipped: false });
    expect(keys.map((k) => k.name)).toEqual([
      `surviel:${userId}:1`,
      `surviel:${userId}:2`,
      `surviel:${userId}:3`,
    ]);
    expect(keys.every((k) => k.limit === 0)).toBe(true);
    expect(assigned).toHaveLength(3);
    /** Plaintext key material landed in the store under each tier endpoint name. */
    expect(values.get(`${userId}:Max Model Selection`)).toContain('sk-or-');
    expect(values.get(`${userId}:Commercial Privacy`)).toContain('sk-or-');
    expect(values.get(`${userId}:Enterprise Vault`)).toContain('sk-or-');
  });

  it('skips when Surviel is disabled', async () => {
    const { client } = makeClient();
    const { db } = makeStore();
    const result = await provisionUserOnRegistration({
      db,
      userId,
      client,
      rawConfig: { enabled: false, provisionOnRegistration: true },
    });
    expect(result).toEqual({ provisioned: false, skipped: true });
    expect(client.listAllKeys).not.toHaveBeenCalled();
  });

  it('skips when the registration-provisioning lever is off', async () => {
    const { client } = makeClient();
    const { db } = makeStore();
    const result = await provisionUserOnRegistration({
      db,
      userId,
      client,
      rawConfig: { enabled: true },
    });
    expect(result).toEqual({ provisioned: false, skipped: true });
    expect(client.listAllKeys).not.toHaveBeenCalled();
  });

  it('skips when no OpenRouter client is available (no management key)', async () => {
    const { db } = makeStore();
    const result = await provisionUserOnRegistration({
      db,
      userId,
      client: undefined,
      rawConfig: { enabled: true, provisionOnRegistration: true },
    });
    expect(result).toEqual({ provisioned: false, skipped: true });
  });

  it('never throws when OpenRouter fails — registration must succeed', async () => {
    const { client } = makeClient('createKey');
    const { db } = makeStore();
    const warn = jest.fn();
    const result = await provisionUserOnRegistration({
      db,
      userId,
      client,
      rawConfig: { enabled: true, provisionOnRegistration: true },
      logger: { warn },
    });
    expect(result).toEqual({ provisioned: false, skipped: false });
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
