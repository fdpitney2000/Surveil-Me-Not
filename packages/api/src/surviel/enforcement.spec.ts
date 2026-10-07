import { EModelEndpoint } from 'librechat-data-provider';
import { getOpenAILLMConfig } from '~/endpoints/openai/llm';

/**
 * Proves the tier privacy block survives the parameter pipeline. The server injects
 * `provider` via endpoint `addParams`; a user must not be able to strip or replace it
 * through model parameters. These assert the config that becomes the outbound request body.
 */

function build(addParams: Record<string, unknown>, modelOptions: Record<string, unknown> = {}) {
  return getOpenAILLMConfig({
    apiKey: 'sk-test',
    streaming: true,
    endpoint: EModelEndpoint.custom,
    useOpenRouter: true,
    modelOptions: { model: 'openai/gpt-4o-mini', ...modelOptions },
    addParams,
  });
}

describe('Surviel tier enforcement – provider block', () => {
  it('injects the Tier 2 data-collection block', () => {
    const { llmConfig } = build({ provider: { data_collection: 'deny' } });
    expect(llmConfig.modelKwargs?.provider).toEqual({ data_collection: 'deny' });
  });

  it('injects the Tier 3 ZDR + data-collection block', () => {
    const { llmConfig } = build({ provider: { zdr: true, data_collection: 'deny' } });
    expect(llmConfig.modelKwargs?.provider).toEqual({ zdr: true, data_collection: 'deny' });
  });

  it('discards a user-supplied modelKwargs provider', () => {
    const { llmConfig } = build(
      { provider: { zdr: true, data_collection: 'deny' } },
      { modelKwargs: { provider: { zdr: false } } },
    );
    expect(llmConfig.modelKwargs?.provider).toEqual({ zdr: true, data_collection: 'deny' });
  });

  it('does not let a top-level user provider replace the enforced block', () => {
    const { llmConfig } = build(
      { provider: { zdr: true, data_collection: 'deny' } },
      { provider: { zdr: false, data_collection: 'allow' } },
    );
    // The enforced block lives on the request-body channel; a top-level provider is not
    // merged into it.
    expect(llmConfig.modelKwargs?.provider).toEqual({ zdr: true, data_collection: 'deny' });
  });

  it('leaves Tier 1 without a provider block', () => {
    const { llmConfig } = build({});
    expect(llmConfig.modelKwargs?.provider).toBeUndefined();
  });

  it('applies the enforced block even when the user sets unrelated kwargs', () => {
    const { llmConfig } = build(
      { provider: { zdr: true, data_collection: 'deny' } },
      { modelKwargs: { some_other: 1 } },
    );
    expect(llmConfig.modelKwargs?.provider).toEqual({ zdr: true, data_collection: 'deny' });
  });
});
