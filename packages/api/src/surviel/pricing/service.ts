import type { OpenRouterClient } from '../openrouter/client';

export interface ModelPrice {
  id: string;
  name: string;
  contextLength: number | null;
  /** USD per 1M prompt tokens. */
  promptPerMillionUsd: number;
  /** USD per 1M completion tokens. */
  completionPerMillionUsd: number;
}

export interface PricingSnapshot {
  models: Record<string, ModelPrice>;
  fetchedAt: number;
}

export interface PricingService {
  get: () => Promise<PricingSnapshot | null>;
  refresh: () => Promise<PricingSnapshot>;
  peek: () => PricingSnapshot | null;
}

function perMillion(perToken: string | undefined): number {
  const value = Number(perToken ?? 0);
  return Number.isFinite(value) ? value * 1_000_000 : 0;
}

/**
 * Model-pricing cache with stale-while-revalidate. Prices are for display only; ledger
 * integrity comes from OpenRouter key usage. `now` and `client` are injected for tests.
 */
export function createPricingService(options: {
  client: OpenRouterClient;
  ttlMs: number;
  now?: () => number;
  logger?: { warn: (...args: unknown[]) => void };
}): PricingService {
  const now = options.now ?? (() => Date.now());
  let snapshot: PricingSnapshot | null = null;
  let inFlight: Promise<PricingSnapshot> | null = null;

  async function fetchNow(): Promise<PricingSnapshot> {
    const models = await options.client.listModels();
    const map: Record<string, ModelPrice> = {};
    for (const model of models) {
      map[model.id] = {
        id: model.id,
        name: model.name,
        contextLength: model.context_length ?? null,
        promptPerMillionUsd: perMillion(model.pricing?.prompt),
        completionPerMillionUsd: perMillion(model.pricing?.completion),
      };
    }
    snapshot = { models: map, fetchedAt: now() };
    return snapshot;
  }

  function refresh(): Promise<PricingSnapshot> {
    if (!inFlight) {
      inFlight = fetchNow().finally(() => {
        inFlight = null;
      });
    }
    return inFlight;
  }

  async function get(): Promise<PricingSnapshot | null> {
    if (!snapshot) {
      try {
        return await refresh();
      } catch (error) {
        options.logger?.warn('[Surviel] Pricing fetch failed with no cache:', error);
        return null;
      }
    }
    const age = now() - snapshot.fetchedAt;
    if (age >= options.ttlMs) {
      /* Stale-while-revalidate: serve the cached snapshot and refresh in the background. */
      void refresh().catch((error) =>
        options.logger?.warn('[Surviel] Background pricing refresh failed:', error),
      );
    }
    return snapshot;
  }

  return { get, refresh, peek: () => snapshot };
}
