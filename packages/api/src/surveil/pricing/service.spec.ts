import type { OpenRouterClient, OpenRouterModelPricing } from '../openrouter/client';
import { createPricingService } from './service';

function model(id: string): OpenRouterModelPricing {
  return {
    id,
    canonical_slug: id,
    name: id,
    context_length: 8192,
    pricing: { prompt: '0.000001', completion: '0.000002' },
  };
}

function makeClient() {
  const client = {
    listModels: jest.fn(async () => [model('openai/gpt-4o-mini')]),
  } as unknown as OpenRouterClient;
  return client;
}

describe('pricing service', () => {
  it('fetches and converts per-token prices to per-million', async () => {
    const client = makeClient();
    const now = 0;
    const service = createPricingService({ client, ttlMs: 1000, now: () => now });

    const snapshot = await service.get();
    expect(snapshot?.models['openai/gpt-4o-mini'].promptPerMillionUsd).toBe(1);
    expect(snapshot?.models['openai/gpt-4o-mini'].completionPerMillionUsd).toBe(2);
    expect(client.listModels).toHaveBeenCalledTimes(1);
  });

  it('serves fresh cache without refetching', async () => {
    const client = makeClient();
    let now = 0;
    const service = createPricingService({ client, ttlMs: 1000, now: () => now });

    await service.get();
    now = 500;
    await service.get();
    expect(client.listModels).toHaveBeenCalledTimes(1);
  });

  it('serves stale data and revalidates in the background', async () => {
    const client = makeClient();
    let now = 0;
    const service = createPricingService({ client, ttlMs: 1000, now: () => now });

    await service.get();
    now = 2000;
    const stale = await service.get();
    expect(stale).not.toBeNull();
    // Allow the background refresh to run.
    await new Promise((resolve) => setImmediate(resolve));
    expect(client.listModels).toHaveBeenCalledTimes(2);
  });

  it('force-refreshes on demand', async () => {
    const client = makeClient();
    const service = createPricingService({ client, ttlMs: 1000, now: () => 0 });
    await service.get();
    await service.refresh();
    expect(client.listModels).toHaveBeenCalledTimes(2);
  });

  it('returns null when the first fetch fails', async () => {
    const client = {
      listModels: jest.fn(async () => {
        throw new Error('network');
      }),
    } as unknown as OpenRouterClient;
    const service = createPricingService({ client, ttlMs: 1000 });
    expect(await service.get()).toBeNull();
  });
});
