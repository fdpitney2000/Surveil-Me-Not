/** Shared free-model catalog rules for the OpenRouter free-tier key scripts. */

/** The chat selector should only offer models that produce text. */
export function isTextChatModel(model) {
  // `openrouter/*` entries are meta-routers, not concrete chat models.
  if (typeof model?.id === 'string' && model.id.startsWith('openrouter/')) return false;

  const outputModalities = model?.architecture?.output_modalities;
  if (Array.isArray(outputModalities) && outputModalities.length > 0) {
    return outputModalities.length === 1 && outputModalities[0] === 'text';
  }

  const modality = model?.architecture?.modality;
  if (typeof modality === 'string' && modality.includes('->')) {
    const outputs = modality.split('->').pop()?.split('+') ?? [];
    return outputs.length === 1 && outputs[0] === 'text';
  }

  return !/(?:^|[/:_-])(embedding|embed|rerank|moderation|tts|whisper|image|video|audio)(?:$|[/:_-])/i.test(
    model?.id ?? '',
  );
}

export function isFreeModel(model) {
  if (typeof model?.id === 'string' && model.id.endsWith(':free')) return true;
  return model?.pricing?.prompt === '0' && model?.pricing?.completion === '0';
}

/**
 * OpenRouter's guardrail needs both the catalog alias and the dated canonical
 * slug; older guardrails were built with canonical slugs while requests use
 * the short alias. Include both so additions do not silently become blocked.
 */
export function freeModelAllowedIds(models) {
  const ids = new Set();
  for (const model of models) {
    if (!isFreeModel(model) || !isTextChatModel(model)) continue;
    ids.add(model.id);
    if (
      model.id.endsWith(':free') &&
      typeof model.canonical_slug === 'string' &&
      model.canonical_slug.length > 0
    ) {
      ids.add(`${model.canonical_slug}:free`);
    }
  }
  return [...ids].sort();
}
