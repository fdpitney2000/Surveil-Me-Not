import type { OpenRouterClient, OpenRouterGuardrail } from './client';
import {
  ZDR_FIELDS,
  enableFilteredModelCatalog,
  requireGuardrails,
  resolveGuardrails,
} from './guardrails';
import { resolveSurvielConfig } from '../config';
import { SurvielErrorCodes } from '../errors';

function guardrail(overrides: Partial<OpenRouterGuardrail> = {}): OpenRouterGuardrail {
  return {
    id: 'grd_default',
    name: 'surviel:tier1',
    limit_usd: 180,
    reset_interval: 'monthly',
    ...overrides,
  };
}

function fakeClient(existing: OpenRouterGuardrail[] = []) {
  const store = new Map(existing.map((g) => [g.name, g]));
  let counter = 0;
  const client = {
    listGuardrails: jest.fn(async () => [...store.values()]),
    createGuardrail: jest.fn(async (body: Record<string, unknown>) => {
      counter += 1;
      const created = guardrail({
        id: `grd_new_${counter}`,
        name: String(body.name),
        limit_usd: body.limit_usd as number,
        reset_interval: body.reset_interval as 'monthly',
        enforce_zdr_anthropic: (body.enforce_zdr_anthropic as boolean) ?? null,
        enforce_zdr_openai: (body.enforce_zdr_openai as boolean) ?? null,
        enforce_zdr_google: (body.enforce_zdr_google as boolean) ?? null,
        enforce_zdr_xai: (body.enforce_zdr_xai as boolean) ?? null,
        enforce_zdr_other: (body.enforce_zdr_other as boolean) ?? null,
      });
      store.set(created.name, created);
      return created;
    }),
    updateGuardrail: jest.fn(async (id: string, body: Record<string, unknown>) => {
      const updated = guardrail({
        id,
        name: String(body.name),
        limit_usd: body.limit_usd as number,
        reset_interval: body.reset_interval as 'monthly',
        enforce_zdr_anthropic: (body.enforce_zdr_anthropic as boolean) ?? null,
        enforce_zdr_openai: (body.enforce_zdr_openai as boolean) ?? null,
        enforce_zdr_google: (body.enforce_zdr_google as boolean) ?? null,
        enforce_zdr_xai: (body.enforce_zdr_xai as boolean) ?? null,
        enforce_zdr_other: (body.enforce_zdr_other as boolean) ?? null,
      });
      store.set(updated.name, updated);
      return updated;
    }),
    getOrganizationSettings: jest.fn(async () => ({ is_filtered_model_catalog_enabled: false })),
    updateOrganizationSettings: jest.fn(async () => ({
      is_filtered_model_catalog_enabled: true,
    })),
  } as unknown as OpenRouterClient;

  return { client, store };
}

describe('resolveGuardrails', () => {
  const config = resolveSurvielConfig({ enabled: true });

  it('creates all three guardrails and enables ZDR on tier 3 only', async () => {
    const { client, store } = fakeClient();
    const resolved = await resolveGuardrails({ client, config });

    expect(Object.keys(resolved)).toEqual(['1', '2', '3']);
    const tier3 = store.get('surviel:tier3');
    expect(tier3).toBeDefined();
    for (const field of ZDR_FIELDS) {
      expect(tier3?.[field]).toBe(true);
    }
    expect(store.get('surviel:tier1')?.enforce_zdr_openai ?? null).toBeNull();
    expect(store.get('surviel:tier2')?.enforce_zdr_openai ?? null).toBeNull();
  });

  it('is idempotent: a second run creates nothing', async () => {
    const { client } = fakeClient();
    await resolveGuardrails({ client, config });
    await resolveGuardrails({ client, config });
    expect(client.createGuardrail).toHaveBeenCalledTimes(3);
  });

  it('converges an existing tier-3 guardrail that is missing ZDR', async () => {
    const existing = guardrail({ id: 'grd_3', name: 'surviel:tier3' });
    const { client } = fakeClient([existing]);
    await resolveGuardrails({ client, config });
    expect(client.createGuardrail).not.toHaveBeenCalledWith(
      expect.objectContaining({ name: 'surviel:tier3' }),
    );
    expect(client.updateGuardrail).toHaveBeenCalledWith(
      'grd_3',
      expect.objectContaining({ enforce_zdr_other: true }),
    );
  });
});

describe('requireGuardrails', () => {
  it('throws a coded error when a tier guardrail is missing', async () => {
    const { client } = fakeClient([guardrail({ name: 'surviel:tier1' })]);
    await expect(requireGuardrails({ client })).rejects.toMatchObject({
      code: SurvielErrorCodes.GUARDRAIL_MISSING,
    });
  });
});

describe('enableFilteredModelCatalog', () => {
  it('patches the setting only when it is off', async () => {
    const { client } = fakeClient();
    const result = await enableFilteredModelCatalog({ client });
    expect(result.changed).toBe(true);
    expect(client.updateOrganizationSettings).toHaveBeenCalledWith({
      is_filtered_model_catalog_enabled: true,
    });
  });
});
