import type { TSurveilConfig } from 'librechat-data-provider';
import type { SurveilWebhookLogger } from './stripe/webhook';
import type { OpenRouterClient } from './openrouter/client';
import type { SurveilKeyStore } from './provision';
import { createOpenRouterClientFromEnv } from './openrouter/client';
import { provisionUserKey } from './provision';
import { resolveSurveilConfig } from './config';

/**
 * Best-effort provisioning of limit-0 OpenRouter keys at registration, so a free user can
 * immediately browse the real (guardrail-filtered) model catalog and use `:free` models
 * before subscribing. The first successful payment re-runs the same idempotent
 * provisioning and the reconciler raises key limits from there.
 *
 * Never throws: registration must succeed even when OpenRouter is unreachable, and a
 * missing management key or disabled Surveil config is a no-op so stock deployments are
 * untouched. Failed attempts are retried by payment-time provisioning or the
 * `surveil:openrouter-provision` script.
 */
export async function provisionUserOnRegistration(options: {
  db: SurveilKeyStore;
  userId: string;
  rawConfig?: Partial<TSurveilConfig>;
  client?: OpenRouterClient;
  logger?: SurveilWebhookLogger;
}): Promise<{ provisioned: boolean; skipped: boolean }> {
  const config = resolveSurveilConfig(options.rawConfig);
  if (!config.enabled || !config.provisionOnRegistration) {
    return { provisioned: false, skipped: true };
  }
  const client = options.client ?? createOpenRouterClientFromEnv();
  if (!client) {
    return { provisioned: false, skipped: true };
  }

  try {
    await provisionUserKey({
      client,
      db: options.db,
      userId: options.userId,
      config,
      keyLimitMicroUsd: 0,
      expiresAt: null,
    });
    return { provisioned: true, skipped: false };
  } catch (error) {
    options.logger?.warn(
      '[Surveil] Registration provisioning failed; payment-time provisioning will retry:',
      error instanceof Error ? error.message : error,
    );
    return { provisioned: false, skipped: false };
  }
}
