/** Free-tier catalog policy shared by the bootstrap scripts. Mirrors the server policy. */

export const FREE_TIER_DEFAULTS = {
  maxModels: 10,
  maxOutputPricePerMillionUsd: 1,
  maxAgeDays: 183,
  pinnedModel: 'deepseek/deepseek-v4.1-flash',
};

export function isTextChatModel(model) {
  if (
    typeof model?.id === 'string' &&
    (model.id.startsWith('openrouter/') || model.id.startsWith('~'))
  ) {
    return false;
  }
  const outputModalities = model?.architecture?.output_modalities;
  if (Array.isArray(outputModalities) && outputModalities.length > 0) {
    return outputModalities.length === 1 && outputModalities[0] === 'text';
  }
  const modality = model?.architecture?.modality;
  if (typeof modality === 'string' && modality.includes('->')) {
    const outputs = modality.split('->').pop()?.split('+') ?? [];
    return outputs.length === 1 && outputs[0] === 'text';
  }
  return true;
}

function pricePerMillion(raw) {
  if (raw == null || String(raw).trim() === '') return undefined;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value * 1_000_000 : undefined;
}

export function isEligibleFreeModel(model, policy = FREE_TIER_DEFAULTS, now = new Date()) {
  const id = model?.id?.trim();
  if (!id || id.endsWith(':free') || id.endsWith(':batch')) return false;
  if (!isTextChatModel(model)) return false;
  if (!Array.isArray(model.supported_parameters) || !model.supported_parameters.includes('tools')) {
    return false;
  }
  if (!Number.isFinite(model.created)) return false;
  const ageMs = now.getTime() - Number(model.created) * 1000;
  if (ageMs < 0 || ageMs > policy.maxAgeDays * 24 * 60 * 60 * 1000) return false;
  const outputPrice = pricePerMillion(model.pricing?.completion);
  if (outputPrice == null || outputPrice <= 0) return false;
  if (id !== policy.pinnedModel && outputPrice > policy.maxOutputPricePerMillionUsd) return false;
  return true;
}

/** Return the eligible ids, pinned first, then newest-first, capped at maxModels. */
export function freeTierAllowedIds(models, policy = FREE_TIER_DEFAULTS, now = new Date()) {
  const eligible = models
    .filter((model) => isEligibleFreeModel(model, policy, now))
    .sort((a, b) => (b.created ?? 0) - (a.created ?? 0));
  const pinned = eligible.find((model) => model.id === policy.pinnedModel);
  const ordered = pinned
    ? [pinned, ...eligible.filter((model) => model.id !== policy.pinnedModel)]
    : eligible;
  return ordered.slice(0, policy.maxModels).map((model) => model.id);
}
