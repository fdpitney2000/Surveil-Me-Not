import type { OpenRouterApiKey, OpenRouterClient, OpenRouterGuardrail } from './openrouter/client';
import type { SurveilKeyStore } from './provision';
import { provisionUserOnRegistration } from './registration';

function makeClient(failOn?: 'createKey') {
  const keys: OpenRouterApiKey[] = [];
  let counter = 0;
  const guardrail: OpenRouterGuardrail = {
    id: 'guardrail_free',
    name: 'surveil:free',
    limit_usd: null,
    reset_interval: null,
    allowed_models: ['deepseek/deepseek-v4.1-flash'],
  };
  const client = {
    listAllKeys: jest.fn(async () => [...keys]),
    listKeys: jest.fn(async () => [...keys]),
    listGuardrails: jest.fn(async () => [guardrail]),
    createGuardrail: jest.fn(async () => guardrail),
    updateGuardrail: jest.fn(async () => guardrail),
    assignKeysToGuardrail: jest.fn(async () => 1),
    listModels: jest.fn(async () => [
      {
        id: 'deepseek/deepseek-v4.1-flash',
        canonical_slug: 'deepseek/deepseek-v4.1-flash',
        name: 'DeepSeek V4.1 Flash',
        context_length: 1000000,
        created: Math.floor(Date.now() / 1000) - 86400,
        pricing: { prompt: '0.0000001', completion: '0.0000001' },
        supported_parameters: ['tools'],
        architecture: { output_modalities: ['text'] },
      },
    ]),
    createKey: jest.fn(async ({ name, limit, limit_reset }: { name: string; limit?: number; limit_reset?: string }) => {
      if (failOn === 'createKey') {
        throw new Error('OpenRouter unreachable');
      }
      counter += 1;
      const data: OpenRouterApiKey = {
        hash: `hash_${counter}`,
        name,
        label: `sk-or-v1-...${counter}`,
        disabled: false,
        limit: limit ?? null,
        limit_remaining: limit ?? null,
        limit_reset: (limit_reset as OpenRouterApiKey['limit_reset']) ?? null,
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

  it('provisions one $2/month free key and stores it under every tier endpoint', async () => {
    const { client, keys } = makeClient();
    const { db, values } = makeStore();
    const result = await provisionUserOnRegistration({
      db,
      userId,
      client,
      rawConfig: { enabled: true, freeTierEnabled: true, provisionFreeOnRegistration: true },
    });
    expect(result).toEqual({ provisioned: true, skipped: false });
    expect(keys.map((k) => k.name)).toEqual([`surveil:free:${userId}`]);
    expect(keys[0].limit).toBe(2);
    expect(keys[0].limit_reset).toBe('monthly');
    expect(keys[0].expires_at).toBeNull();
    expect(client.assignKeysToGuardrail).toHaveBeenCalledWith('guardrail_free', ['hash_1']);
    /** Plaintext key material landed in the store under each tier endpoint name. */
    expect(values.get(`${userId}:Max Model Selection`)).toContain('sk-or-');
    expect(values.get(`${userId}:Commercial Privacy`)).toContain('sk-or-');
    expect(values.get(`${userId}:Enterprise Vault`)).toContain('sk-or-');
    expect(values.get(`${userId}:Max Model Selection`)).toContain('"surveilFree":true');
  });

  it('retains legacy zero-limit provisioning when the free tier is off', async () => {
    const { client, keys } = makeClient();
    const { db } = makeStore();
    const result = await provisionUserOnRegistration({
      db,
      userId,
      client,
      rawConfig: {
        enabled: true,
        freeTierEnabled: false,
        provisionOnRegistration: true,
      },
    });
    expect(result).toEqual({ provisioned: true, skipped: false });
    expect(keys.map((k) => k.name)).toEqual([`surveil:${userId}`]);
    expect(keys[0].limit).toBe(0);
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

  it('skips when both registration-provisioning levers are off', async () => {
    const { client } = makeClient();
    const { db } = makeStore();
    const result = await provisionUserOnRegistration({
      db,
      userId,
      client,
      rawConfig: {
        enabled: true,
        provisionFreeOnRegistration: false,
        provisionOnRegistration: false,
      },
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
      rawConfig: { enabled: true, provisionFreeOnRegistration: true },
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
      rawConfig: { enabled: true, provisionFreeOnRegistration: true },
      logger: { warn },
    });
    expect(result).toEqual({ provisioned: false, skipped: false });
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
