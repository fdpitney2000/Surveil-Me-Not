import type { OpenRouterModelPricing } from './openrouter/client';

/** Stable id pinned to the top of the subsidized free-tier picker. */
export const DEFAULT_FREE_TIER_PINNED_MODEL = 'deepseek/deepseek-v4.1-flash';

export interface FreeModelPolicy {
  /** Maximum number of models exposed in the free-tier picker. */
  maxModels: number;
  /** Maximum output price in USD per one million tokens. */
  maxOutputPricePerMillionUsd: number;
  /** Maximum model age in days, measured from OpenRouter's `created` timestamp. */
  maxAgeDays: number;
  /** Always shown first when it is available in the catalog. */
  pinnedModel: string;
}

export const DEFAULT_FREE_MODEL_POLICY: FreeModelPolicy = {
  maxModels: 10,
  maxOutputPricePerMillionUsd: 1,
  maxAgeDays: 183,
  pinnedModel: DEFAULT_FREE_TIER_PINNED_MODEL,
};

interface CatalogModel {
  id?: string;
  created?: number;
  pricing?: Record<string, string>;
  supported_parameters?: string[];
  architecture?: {
    output_modalities?: string[];
    modality?: string;
  };
}

function pricePerMillion(raw: string | undefined): number | undefined {
  if (raw == null || raw.trim() === '') {
    return undefined;
  }
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) {
    return undefined;
  }
  return value * 1_000_000;
}

function isTextOutputModel(model: CatalogModel): boolean {
  const outputModalities = model.architecture?.output_modalities;
  if (Array.isArray(outputModalities) && outputModalities.length > 0) {
    return outputModalities.length === 1 && outputModalities[0] === 'text';
  }
  const modality = model.architecture?.modality;
  if (typeof modality === 'string' && modality.includes('->')) {
    const outputs = modality.split('->').pop()?.split('+') ?? [];
    return outputs.length === 1 && outputs[0] === 'text';
  }
  return true;
}

/**
 * A model is eligible for the subsidized tier only when it is a concrete,
 * text-output chat model that supports tool calling and is recent/cheap enough.
 * `:free` variants are deliberately excluded: the free tier is funded through
 * a paid shared pool, not OpenRouter's shared free-model pool.
 */
export function isEligibleFreeTierModel(
  model: CatalogModel,
  policy: FreeModelPolicy,
  now: Date = new Date(),
): boolean {
  const id = model.id?.trim();
  if (!id || id.startsWith('openrouter/') || id.startsWith('~')) {
    return false;
  }
  if (id.endsWith(':free') || id.endsWith(':batch')) {
    return false;
  }
  if (!isTextOutputModel(model)) {
    return false;
  }
  if (!Array.isArray(model.supported_parameters) || !model.supported_parameters.includes('tools')) {
    return false;
  }

  const created = model.created;
  if (!Number.isFinite(created)) {
    return false;
  }
  const ageMs = now.getTime() - Number(created) * 1000;
  if (ageMs < 0 || ageMs > policy.maxAgeDays * 24 * 60 * 60 * 1000) {
    return false;
  }

  const outputPrice = pricePerMillion(model.pricing?.completion);
  const isPinned = id === policy.pinnedModel;
  /**
   * The pinned model is a product choice, not just a price discovery result. OpenRouter
   * can change its list price after we pin it, so keep the pin while still rejecting free
   * or zero-priced entries. Everything else must satisfy the configured cap.
   */
  if (outputPrice == null || outputPrice <= 0) {
    return false;
  }
  if (!isPinned && outputPrice > policy.maxOutputPricePerMillionUsd) {
    return false;
  }
  return true;
}

/**
 * Select the free-tier catalog. The pinned model is always first (when it is
 * eligible), then the remaining models newest-first. The resulting list never
 * exceeds `maxModels` total.
 */
export function selectFreeTierModels<T extends CatalogModel>(
  catalog: T[],
  policy: FreeModelPolicy = DEFAULT_FREE_MODEL_POLICY,
  now: Date = new Date(),
): T[] {
  const eligible = catalog.filter((model) => isEligibleFreeTierModel(model, policy, now));
  const sorted = [...eligible].sort((a, b) => (b.created ?? 0) - (a.created ?? 0));
  const pinned = sorted.find((model) => model.id === policy.pinnedModel);

  if (!pinned) {
    return sorted.slice(0, policy.maxModels);
  }

  const rest = sorted.filter((model) => model.id !== policy.pinnedModel);
  return [pinned, ...rest].slice(0, policy.maxModels);
}

/** Convenience for callers that only need model ids. */
export function selectFreeTierModelIds(
  catalog: OpenRouterModelPricing[],
  policy: FreeModelPolicy = DEFAULT_FREE_MODEL_POLICY,
  now: Date = new Date(),
): string[] {
  return selectFreeTierModels(catalog, policy, now)
    .map((model) => model.id)
    .filter((id): id is string => typeof id === 'string' && id.length > 0);
}
