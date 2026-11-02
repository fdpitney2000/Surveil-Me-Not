import type { TSurvielConfig } from 'librechat-data-provider';
import type { SurvielWebhookLogger } from './stripe/webhook';
import type { OpenRouterClient } from './openrouter/client';
import type { SurvielKeyStore } from './provision';
import { createOpenRouterClientFromEnv } from './openrouter/client';
import { provisionUserKeys } from './provision';
import { resolveSurvielConfig } from './config';

/**
 * Best-effort provisioning of limit-0 OpenRouter keys at registration, so a free user can
 * immediately browse the real (guardrail-filtered) model catalog and use `:free` models
 * before subscribing. The first successful payment re-runs the same idempotent
 * provisioning and the reconciler raises key limits from there.
 *
 * Never throws: registration must succeed even when OpenRouter is unreachable, and a
 * missing management key or disabled Surviel config is a no-op so stock deployments are
 * untouched. Failed attempts are retried by payment-time provisioning or the
 * `surviel:openrouter-provision` script.
 */
export async function provisionUserOnRegistration(options: {
  db: SurvielKeyStore;
  userId: string;
  rawConfig?: Partial<TSurvielConfig>;
  client?: OpenRouterClient;
  logger?: SurvielWebhookLogger;
}): Promise<{ provisioned: boolean; skipped: boolean }> {
  const config = resolveSurvielConfig(options.rawConfig);
  if (!config.enabled || !config.provisionOnRegistration) {
    return { provisioned: false, skipped: true };
  }
  const client = options.client ?? createOpenRouterClientFromEnv();
  if (!client) {
    return { provisioned: false, skipped: true };
  }

  try {
    await provisionUserKeys({ client, db: options.db, userId: options.userId, config });
    return { provisioned: true, skipped: false };
  } catch (error) {
    options.logger?.warn(
      '[Surviel] Registration provisioning failed; payment-time provisioning will retry:',
      error instanceof Error ? error.message : error,
    );
    return { provisioned: false, skipped: false };
  }
}
