import { createOpenRouterClient, createOpenRouterClientFromEnv } from './client';
import { SurvielErrorCodes } from '../errors';

const KEY = 'sk-or-v1-management-secret-value';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function keyRecord(overrides: Record<string, unknown> = {}) {
  return {
    hash: 'abc123',
    name: 'surviel:user:1',
    label: 'sk-or-v1-...123',
    disabled: false,
    limit: 0,
    limit_remaining: 0,
    limit_reset: null,
    include_byok_in_limit: false,
    usage: 1.25,
    usage_daily: 0,
    usage_weekly: 0,
    usage_monthly: 0,
    byok_usage: 0,
    created_at: '2025-01-01T00:00:00Z',
    updated_at: null,
    ...overrides,
  };
}

describe('createOpenRouterClient', () => {
  it('creates a key, returns the plaintext once, and sends the management bearer', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl = async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return jsonResponse({ data: keyRecord(), key: 'sk-or-v1-plaintext-once' });
    };
    const client = createOpenRouterClient({ managementKey: KEY, fetchImpl });

    const result = await client.createKey({ name: 'surviel:user:1', limit: 0 });
    expect(result.key).toBe('sk-or-v1-plaintext-once');
    expect(result.data.hash).toBe('abc123');
    expect(calls[0].url).toBe('https://openrouter.ai/api/v1/keys');
    expect((calls[0].init?.headers as Record<string, string>).Authorization).toBe(`Bearer ${KEY}`);
  });

  it('paginates listAllKeys until a short page', async () => {
    const full = Array.from({ length: 100 }, (_, i) => keyRecord({ hash: `h${i}` }));
    const fetchImpl = async (url: string) => {
      if (url.includes('offset=0')) return jsonResponse({ data: full });
      return jsonResponse({ data: [keyRecord({ hash: 'last' })] });
    };
    const client = createOpenRouterClient({ managementKey: KEY, fetchImpl });
    const all = await client.listAllKeys();
    expect(all).toHaveLength(101);
    expect(all[all.length - 1].hash).toBe('last');
  });

  it('throws a coded error without leaking the management key on failure', async () => {
    const fetchImpl = async () =>
      jsonResponse({ error: { code: 401, message: 'Missing Authentication header' } }, 401);
    const client = createOpenRouterClient({ managementKey: KEY, fetchImpl });
    await expect(client.listKeys()).rejects.toMatchObject({
      code: SurvielErrorCodes.OPENROUTER_ERROR,
      status: 401,
    });
    await client.listKeys().catch((error: Error) => {
      expect(error.message).not.toContain(KEY);
    });
  });

  it('throws NOT_CONFIGURED when no management key is present', async () => {
    const client = createOpenRouterClient({ managementKey: '' });
    await expect(client.getCredits()).rejects.toMatchObject({
      code: SurvielErrorCodes.NOT_CONFIGURED,
    });
  });

  it('accepts the OPENROUTER_MANAGEMENT_API_KEY alias', () => {
    const original = {
      key: process.env.OPENROUTER_MANAGEMENT_KEY,
      alias: process.env.OPENROUTER_MANAGEMENT_API_KEY,
    };
    delete process.env.OPENROUTER_MANAGEMENT_KEY;
    process.env.OPENROUTER_MANAGEMENT_API_KEY = 'sk-or-v1-alias';
    try {
      const client = createOpenRouterClientFromEnv(async () => jsonResponse({ data: [] }));
      expect(client).toBeDefined();
    } finally {
      if (original.key === undefined) delete process.env.OPENROUTER_MANAGEMENT_KEY;
      else process.env.OPENROUTER_MANAGEMENT_KEY = original.key;
      if (original.alias === undefined) delete process.env.OPENROUTER_MANAGEMENT_API_KEY;
      else process.env.OPENROUTER_MANAGEMENT_API_KEY = original.alias;
    }
  });

  it('returns undefined when neither management key name is set', () => {
    const original = {
      key: process.env.OPENROUTER_MANAGEMENT_KEY,
      alias: process.env.OPENROUTER_MANAGEMENT_API_KEY,
    };
    delete process.env.OPENROUTER_MANAGEMENT_KEY;
    delete process.env.OPENROUTER_MANAGEMENT_API_KEY;
    try {
      expect(createOpenRouterClientFromEnv()).toBeUndefined();
    } finally {
      if (original.key !== undefined) process.env.OPENROUTER_MANAGEMENT_KEY = original.key;
      if (original.alias !== undefined) process.env.OPENROUTER_MANAGEMENT_API_KEY = original.alias;
    }
  });

  it('assigns key hashes to a guardrail', async () => {
    let body: unknown;
    const fetchImpl = async (_url: string, init?: RequestInit) => {
      body = JSON.parse(String(init?.body));
      return jsonResponse({ assigned_count: 1 });
    };
    const client = createOpenRouterClient({ managementKey: KEY, fetchImpl });
    const count = await client.assignKeysToGuardrail('grd_1', ['abc123']);
    expect(count).toBe(1);
    expect(body).toEqual({ key_hashes: ['abc123'] });
  });
});
