import {
  DEFAULT_FREE_MODEL_POLICY,
  isEligibleFreeTierModel,
  selectFreeTierModelIds,
  type FreeModelPolicy,
} from './free-models';

const NOW = new Date('2026-11-18T00:00:00Z');
const RECENT = Math.floor(NOW.getTime() / 1000) - 30 * 24 * 60 * 60;
const OLD = Math.floor(NOW.getTime() / 1000) - 365 * 24 * 60 * 60;

function model(overrides: Record<string, unknown> = {}) {
  return {
    id: 'vendor/model',
    canonical_slug: 'vendor/model-2026-01-01',
    name: 'Vendor Model',
    context_length: 128000,
    created: RECENT,
    pricing: { prompt: '0.0000001', completion: '0.0000001' },
    supported_parameters: ['tools', 'temperature'],
    architecture: { output_modalities: ['text'] },
    ...overrides,
  };
}

describe('free-tier model policy', () => {
  it('accepts a recent, cheap, tool-capable text model', () => {
    expect(isEligibleFreeTierModel(model(), DEFAULT_FREE_MODEL_POLICY, NOW)).toBe(true);
  });

  it.each([
    ['free variant', { id: 'vendor/model:free' }],
    ['batch variant', { id: 'vendor/model:batch' }],
    ['router', { id: 'openrouter/auto' }],
    ['no tools', { supported_parameters: ['temperature'] }],
    ['expensive output', { pricing: { prompt: '0.0000001', completion: '0.000002' } }],
    ['too old', { created: OLD }],
    ['non-text output', { architecture: { output_modalities: ['image'] } }],
  ])('rejects %s', (_name, overrides) => {
    expect(isEligibleFreeTierModel(model(overrides), DEFAULT_FREE_MODEL_POLICY, NOW)).toBe(false);
  });

  it('keeps the pinned model even when OpenRouter later raises its price above the cap', () => {
    const pinned = model({
      id: 'deepseek/deepseek-v4.1-flash',
      pricing: { prompt: '0.0000003', completion: '0.0000012' },
    });
    const other = model({ id: 'vendor/other', created: RECENT + 100 });
    expect(
      selectFreeTierModelIds([other, pinned], DEFAULT_FREE_MODEL_POLICY, NOW),
    ).toEqual(['deepseek/deepseek-v4.1-flash', 'vendor/other']);
  });

  it('pins DeepSeek first, sorts the rest newest-first, and caps at ten', () => {
    const policy: FreeModelPolicy = { ...DEFAULT_FREE_MODEL_POLICY, maxModels: 3 };
    const models = [
      model({ id: 'vendor/old', created: RECENT - 1 }),
      model({ id: 'deepseek/deepseek-v4.1-flash', created: RECENT - 100 }),
      model({ id: 'vendor/newest', created: RECENT + 100 }),
      model({ id: 'vendor/middle', created: RECENT + 50 }),
      model({ id: 'vendor/fourth', created: RECENT + 10 }),
    ];
    expect(selectFreeTierModelIds(models, policy, NOW)).toEqual([
      'deepseek/deepseek-v4.1-flash',
      'vendor/newest',
      'vendor/middle',
    ]);
  });
});
