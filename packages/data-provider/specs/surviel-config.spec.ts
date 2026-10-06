import { configSchema, endpointSchema, survielConfigSchema } from '../src/config';

describe('survielConfigSchema', () => {
  it('applies documented defaults when a block is present', () => {
    const parsed = survielConfigSchema.parse({ enabled: true });
    expect(parsed).toEqual(
      expect.objectContaining({
        enabled: true,
        reconcileIntervalMs: 120_000,
        pricingTtlMs: 3_600_000,
        keyLimitMode: 'allocate',
        creditGrantRatio: 0.9,
        guardrailBackstopUsd: 180,
        mgmtKeyWarnDays: 14,
      }),
    );
    expect(parsed?.tiers).toHaveLength(3);
    expect(parsed?.tiers?.map((t) => t.tier)).toEqual([1, 2, 3]);
  });

  it('is optional, so a stock config without a surviel block still parses', () => {
    const result = configSchema.safeParse({ version: '1.3.7' });
    expect(result.success).toBe(true);
    expect(result.success && result.data.surviel).toBeUndefined();
  });

  it('rejects unknown levers inside the block', () => {
    const result = configSchema.safeParse({
      version: '1.3.7',
      surviel: { enabled: true, notALever: 1 },
    });
    expect(result.success).toBe(false);
  });

  it('accepts a full block with custom tiers', () => {
    const result = configSchema.safeParse({
      version: '1.3.7',
      surviel: {
        enabled: true,
        keyLimitMode: 'duplicate',
        tiers: [
          { tier: 1, endpoint: 'Max Model Selection', description: 'a' },
          { tier: 2, endpoint: 'Commercial Privacy', description: 'b' },
          { tier: 3, endpoint: 'Enterprise Vault', description: 'c' },
        ],
      },
    });
    expect(result.success).toBe(true);
  });
});

describe('endpointSchema – surviel fields', () => {
  it('accepts a description and hideUserProvidedKey', () => {
    const result = endpointSchema.safeParse({
      name: 'Enterprise Vault',
      apiKey: 'user_provided',
      baseURL: 'https://openrouter.ai/api/v1',
      models: { default: ['openai/gpt-4o-mini'], fetch: true },
      description: 'Zero Data Retention enforced.',
      hideUserProvidedKey: true,
      addParams: { provider: { zdr: true, data_collection: 'deny' } },
    });
    expect(result.success).toBe(true);
  });

  it('accepts nested addParams objects', () => {
    const result = endpointSchema.safeParse({
      name: 'Commercial Privacy',
      apiKey: 'user_provided',
      baseURL: 'https://openrouter.ai/api/v1',
      models: { default: ['openai/gpt-4o-mini'] },
      addParams: { provider: { data_collection: 'deny' } },
    });
    expect(result.success).toBe(true);
  });
});
