import { ReasoningEffort } from 'librechat-data-provider';
import { applySurveilReasoningDefault, FREE_TIER_PINNED_MODEL } from '../surveilModelDefaults';

describe('applySurveilReasoningDefault', () => {
  it('turns thinking off for the pinned DeepSeek model', () => {
    const conversation = { model: FREE_TIER_PINNED_MODEL, reasoning_effort: undefined };
    applySurveilReasoningDefault(conversation);
    expect(conversation.reasoning_effort).toBe(ReasoningEffort.none);
  });

  it('matches the dated DeepSeek model id', () => {
    const conversation = {
      model: `${FREE_TIER_PINNED_MODEL}-1017`,
      reasoning_effort: null,
    };
    applySurveilReasoningDefault(conversation);
    expect(conversation.reasoning_effort).toBe(ReasoningEffort.none);
  });

  it('preserves an explicit reasoning choice', () => {
    const conversation = {
      model: FREE_TIER_PINNED_MODEL,
      reasoning_effort: ReasoningEffort.high,
    };
    applySurveilReasoningDefault(conversation);
    expect(conversation.reasoning_effort).toBe(ReasoningEffort.high);
  });

  it('does not change another model', () => {
    const conversation = { model: 'openai/gpt-6-sol', reasoning_effort: undefined };
    applySurveilReasoningDefault(conversation);
    expect(conversation.reasoning_effort).toBeUndefined();
  });
});
