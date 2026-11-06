import type { OpenRouterApiKey, OpenRouterClient } from './openrouter/client';
import type { SurveilKeyStore } from './provision';
import { provisionUserOnRegistration } from './registration';

function makeClient(failOn?: 'createKey') {
  const keys: OpenRouterApiKey[] = [];
  let counter = 0;
  const client = {
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
        expires_at: null,
      };
      keys.push(data);
      return { key: `sk-or-...ext-${counter}`, data };
    }),
    deleteKey: jest.fn(async (hash: string) => {
      const index = keys.findIndex((k) => k.hash === hash);
      if (index >= 0) keys.splice(index, 1);
    }),
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

describe('provisionUserOnRegistration', () => {
  const userId = 'user_abc123';

  it('provisions one limit-0 key and stores it under every tier endpoint', async () => {
    const { client, keys } = makeClient();
    const { db, values } = makeStore();
    const result = await provisionUserOnRegistration({
      db,
      userId,
      client,
      rawConfig: { enabled: true, provisionOnRegistration: true },
    });
    expect(result).toEqual({ provisioned: true, skipped: false });
    expect(keys.map((k) => k.name)).toEqual([`surveil:${userId}`]);
    expect(keys[0].limit).toBe(0);
    expect(keys[0].expires_at).toBeNull();
    /** Plaintext key material landed in the store under each tier endpoint name. */
    expect(values.get(`${userId}:Max Model Selection`)).toContain('sk-or-');
    expect(values.get(`${userId}:Commercial Privacy`)).toContain('sk-or-');
    expect(values.get(`${userId}:Enterprise Vault`)).toContain('sk-or-');
  });

  it('skips when Surveil is disabled', async () => {
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
