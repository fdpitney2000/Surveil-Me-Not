import { ReasoningEffort } from 'librechat-data-provider';
import type { TConversation } from 'librechat-data-provider';

/** Shared client-side defaults for Surveil privacy-tier model selection. */

export const PREFERRED_FREE_MODELS = ['deepseek/deepseek-v4.1-flash'];

/** The model pinned to the top of the subsidized tier on the server. */
export const FREE_TIER_PINNED_MODEL = PREFERRED_FREE_MODELS[0];

/**
 * DeepSeek V4.1 Flash enables high-effort thinking by default. New Surveil conversations
 * should open in non-thinking mode so the first response is fast; the user can still raise
 * the reasoning effort from Parameters.
 */
export const DEFAULT_SURVEIL_REASONING_EFFORT = ReasoningEffort.none;

const FALLBACK_SURVEIL_TIERS = new Set([
  'Max Model Selection',
  'Commercial Privacy',
  'Enterprise Vault',
]);

export function isSurveilTierEndpoint(
  endpoint: string | null | undefined,
  tiers?: Array<{ endpoint: string }>,
): boolean {
  if (tiers?.length) {
    return tiers.some((tier) => tier.endpoint === endpoint);
  }
  return FALLBACK_SURVEIL_TIERS.has(String(endpoint));
}

export function getPreferredFreeModel(models: string[]): string | undefined {
  return PREFERRED_FREE_MODELS.find((model) => models.includes(model)) ?? models[0];
}

/**
 * Applies the non-thinking default only when the conversation is still on the pinned
 * DeepSeek model and has no explicit reasoning choice. Model ids may carry a dated suffix
 * (`-1017`), so match the prefix.
 */
export function applySurveilReasoningDefault(
  conversation: Pick<TConversation, 'model' | 'reasoning_effort'>,
): void {
  const model = conversation.model;
  if (!model || !model.startsWith(FREE_TIER_PINNED_MODEL)) {
    return;
  }
  if (
    conversation.reasoning_effort == null ||
    conversation.reasoning_effort === ReasoningEffort.unset
  ) {
    conversation.reasoning_effort = DEFAULT_SURVEIL_REASONING_EFFORT;
  }
}
