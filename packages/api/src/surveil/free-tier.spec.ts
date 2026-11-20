import type { OpenRouterApiKey, OpenRouterClient, OpenRouterGuardrail } from './openrouter/client';
import type { SurveilKeyStore } from './provision';
import { resolveSurveilConfig } from './config';
import { SurveilErrorCodes } from './errors';
import {
  ensureFreeTierKey,
  fetchFreeTierUsage,
  hasPaidSurveilAccess,
  resetFreeTierCaches,
} from './free-tier';

const NOW = Math.floor(Date.now() / 1000) - 86400;
const CONFIG = resolveSurveilConfig({ enabled: true, freeTierEnabled: true });

function apiKey(overrides: Partial<OpenRouterApiKey> = {}): OpenRouterApiKey {
  return {
    hash: 'hash_existing',
    name: 'surveil:free:user_1',
    label: 'sk-or-v1-...existing',
    disabled: false,
    limit: 2,
    limit_remaining: 2,
    limit_reset: 'monthly',
    include_byok_in_limit: false,
    usage: 0,
    usage_daily: 0,
    usage_weekly: 0,
    usage_monthly: 0,
    byok_usage: 0,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: null,
    expires_at: null,
    ...overrides,
  };
}

function makeClient(options: { keys?: OpenRouterApiKey[]; usage?: number } = {}) {
  const keys = [...(options.keys ?? [])];
  const guardrail: OpenRouterGuardrail = {
    id: 'guardrail_free',
    name: 'surveil:free',
    limit_usd: null,
    reset_interval: null,
    allowed_models: [],
  };
  const client = {
    listAllKeys: jest.fn(async () => [...keys]),
    listGuardrails: jest.fn(async () => [guardrail]),
    listModels: jest.fn(async () => [
      {
        id: 'deepseek/deepseek-v4.1-flash',
        canonical_slug: 'deepseek/deepseek-v4.1-flash',
        name: 'DeepSeek V4.1 Flash',
        context_length: 1000000,
        created: NOW,
        pricing: { prompt: '0.0000001', completion: '0.0000001' },
        supported_parameters: ['tools'],
        architecture: { output_modalities: ['text'] },
      },
      {
        id: 'vendor/paid-out',
        canonical_slug: 'vendor/paid-out',
        name: 'Paid Out',
        context_length: 1000,
        created: NOW,
        pricing: { prompt: '0.0000001', completion: '0.000005' },
        supported_parameters: ['tools'],
        architecture: { output_modalities: ['text'] },
      },
      {
        id: 'vendor/free',
        canonical_slug: 'vendor/free',
        name: 'Free',
        context_length: 1000,
        created: NOW,
        pricing: { prompt: '0', completion: '0' },
        supported_parameters: ['tools'],
        architecture: { output_modalities: ['text'] },
      },
    ]),
    createGuardrail: jest.fn(async () => guardrail),
    updateGuardrail: jest.fn(async () => guardrail),
    assignKeysToGuardrail: jest.fn(async () => 1),
    createKey: jest.fn(async ({ name, limit, limit_reset }: { name: string; limit?: number; limit_reset?: string }) => {
      const data = apiKey({
        hash: 'hash_new',
        name,
        limit: limit ?? null,
        limit_reset: (limit_reset as OpenRouterApiKey['limit_reset']) ?? null,
        usage_monthly: options.usage ?? 0,
      });
      keys.push(data);
      return { key: 'sk-or-v1-new', data };
    }),
    deleteKey: jest.fn(async (hash: string) => {
      const index = keys.findIndex((key) => key.hash === hash);
      if (index >= 0) keys.splice(index, 1);
    }),
  } as unknown as OpenRouterClient;
  return { client, keys, guardrail };
}

function makeStore(prefix = 'user_1') {
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
  return { db, values, prefix };
}

describe('free-tier key provisioning', () => {
  beforeEach(() => resetFreeTierCaches());

  it('creates a $2 monthly key, assigns the guardrail, and stores the free marker', async () => {
    const { client, guardrail } = makeClient();
    const { db, values } = makeStore();
    const result = await ensureFreeTierKey({
      client,
      db,
      userId: 'user_1',
      config: CONFIG,
    });

    expect(result.created).toBe(true);
    expect(result.apiKey).toBe('sk-or-v1-new');
    expect(client.createKey).toHaveBeenCalledWith({
      name: 'surveil:free:user_1',
      limit: 2,
      limit_reset: 'monthly',
      expires_at: null,
    });
    expect(client.assignKeysToGuardrail).toHaveBeenCalledWith(guardrail.id, ['hash_new']);
    expect(values.get('user_1:Max Model Selection')).toContain('"surveilFree":true');
    expect(values.get('user_1:Commercial Privacy')).toContain('"surveilFree":true');
    expect(values.get('user_1:Enterprise Vault')).toContain('"surveilFree":true');
  });

  it('sends only eligible models to the guardrail', async () => {
    const { client } = makeClient();
    const { db } = makeStore();
    await ensureFreeTierKey({ client, db, userId: 'user_1', config: CONFIG });
    expect(client.updateGuardrail).toHaveBeenCalledWith(
      'guardrail_free',
      expect.objectContaining({
        name: 'surveil:free',
        allowed_models: ['deepseek/deepseek-v4.1-flash'],
      }),
    );
  });

  it('reuses an existing stored key without creating another one', async () => {
    const existing = apiKey();
    const { client } = makeClient({ keys: [existing] });
    const { db, values } = makeStore();
    values.set('user_1:Max Model Selection', JSON.stringify({ apiKey: 'sk-or-existing', surveilFree: true }));
    const result = await ensureFreeTierKey({ client, db, userId: 'user_1', config: CONFIG });
    expect(result).toEqual({ apiKey: 'sk-or-existing', created: false, keyHash: 'hash_existing' });
    expect(client.createKey).not.toHaveBeenCalled();
  });

  it('blocks at the $10 aggregate ceiling before creating a key', async () => {
    const { client } = makeClient({
      keys: [
        apiKey({ hash: 'hash_a', name: 'surveil:free:user_a', usage_monthly: 6 }),
        apiKey({ hash: 'hash_b', name: 'surveil:free:user_b', usage_monthly: 4 }),
      ],
    });
    const { db } = makeStore();
    await expect(
      ensureFreeTierKey({ client, db, userId: 'user_1', config: CONFIG }),
    ).rejects.toMatchObject({ code: SurveilErrorCodes.FREE_TIER_EXHAUSTED });
    expect(client.createKey).not.toHaveBeenCalled();
  });

  it('sums only free-tier keys for the global ceiling', async () => {
    const { client } = makeClient({
      keys: [
        apiKey({ name: 'surveil:free:user_a', usage_monthly: 3 }),
        apiKey({ name: 'surveil:user_paid', usage_monthly: 100 }),
      ],
    });
    await expect(fetchFreeTierUsage(client)).resolves.toBe(3);
  });

  it('treats a usable subscription as paid and a missing/canceled one as free', async () => {
    const active = {
      getSurveilSubscriptionByUser: async () => ({ status: 'active' }) as never,
    };
    const missing = { getSurveilSubscriptionByUser: async () => null };
    const canceled = {
      getSurveilSubscriptionByUser: async () =>
        ({ status: 'canceled', renewsAt: new Date(Date.now() - 60_000) }) as never,
    };
    await expect(hasPaidSurveilAccess(active, 'user_1')).resolves.toBe(true);
    await expect(hasPaidSurveilAccess(missing, 'user_1')).resolves.toBe(false);
    await expect(hasPaidSurveilAccess(canceled, 'user_1')).resolves.toBe(false);
  });
});
