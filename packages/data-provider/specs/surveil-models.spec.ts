import { isSurveilFreeModel, sortSurveilModelsFreeFirst } from '../src/surveil';
import type { TSurveilModelPrice } from '../src/surveil';

const freePrice: TSurveilModelPrice = {
  id: 'google/gemma-4-31b-it:free',
  name: 'Gemma Free',
  contextLength: 8192,
  promptPerMillionUsd: 0,
  completionPerMillionUsd: 0,
};

const paidPrice: TSurveilModelPrice = {
  id: 'openai/gpt-4o',
  name: 'GPT-4o',
  contextLength: 128000,
  promptPerMillionUsd: 2.5,
  completionPerMillionUsd: 10,
};

describe('isSurveilFreeModel', () => {
  it('uses the pricing snapshot when present', () => {
    const models = { [freePrice.id]: freePrice, [paidPrice.id]: paidPrice };
    expect(isSurveilFreeModel(freePrice.id, models)).toBe(true);
    expect(isSurveilFreeModel(paidPrice.id, models)).toBe(false);
  });

  it('treats a model with zero prompt but nonzero completion price as paid', () => {
    const mixed: TSurveilModelPrice = { ...paidPrice, promptPerMillionUsd: 0 };
    expect(isSurveilFreeModel(mixed.id, { [mixed.id]: mixed })).toBe(false);
  });

  it('falls back to the :free id suffix when pricing is missing', () => {
    expect(isSurveilFreeModel('google/gemma-4-31b-it:free', undefined)).toBe(true);
    expect(isSurveilFreeModel('google/gemma-4-31b-it:free', {})).toBe(true);
    expect(isSurveilFreeModel('openai/gpt-4o', undefined)).toBe(false);
  });
});

describe('sortSurveilModelsFreeFirst', () => {
  const models = { [freePrice.id]: freePrice, [paidPrice.id]: paidPrice };

  it('puts free models first while preserving order within each group', () => {
    const input = ['openai/gpt-4o', 'google/gemma-4-31b-it:free', 'anthropic/claude', 'x/y:free'];
    const sorted = sortSurveilModelsFreeFirst(input, models);
    expect(sorted).toEqual([
      'google/gemma-4-31b-it:free',
      'x/y:free',
      'openai/gpt-4o',
      'anthropic/claude',
    ]);
  });

  it('does not mutate the input', () => {
    const input = ['openai/gpt-4o', 'google/gemma-4-31b-it:free'];
    sortSurveilModelsFreeFirst(input, models);
    expect(input).toEqual(['openai/gpt-4o', 'google/gemma-4-31b-it:free']);
  });
});
