import type { TSurveilConfig } from 'librechat-data-provider';
import type { SurveilWebhookLogger } from './stripe/webhook';
import type { OpenRouterClient } from './openrouter/client';
import type { SurveilKeyStore } from './provision';
import { createOpenRouterClientFromEnv } from './openrouter/client';
import { ensureFreeTierKey } from './free-tier';
import { provisionUserKey } from './provision';
import { resolveSurveilConfig } from './config';

/**
 * Best-effort provisioning at registration. With the subsidized tier enabled, a new
 * unsubscribed user gets a $2/month OpenRouter key assigned to the free guardrail. The
 * first successful payment replaces it with a paid key. Legacy zero-limit provisioning is
 * retained for deployments that explicitly disable the free tier.
 *
 * Never throws: registration must succeed even when OpenRouter is unreachable, and a
 * missing management key or disabled Surveil config is a no-op so stock deployments are
 * untouched. Failed attempts are retried lazily by endpoint initialization.
 */
export async function provisionUserOnRegistration(options: {
  db: SurveilKeyStore;
  userId: string;
  rawConfig?: Partial<TSurveilConfig>;
  client?: OpenRouterClient;
  logger?: SurveilWebhookLogger;
}): Promise<{ provisioned: boolean; skipped: boolean }> {
  const config = resolveSurveilConfig(options.rawConfig);
  if (
    !config.enabled ||
    (!config.provisionFreeOnRegistration && !config.provisionOnRegistration)
  ) {
    return { provisioned: false, skipped: true };
  }
  const client = options.client ?? createOpenRouterClientFromEnv();
  if (!client) {
    return { provisioned: false, skipped: true };
  }

  try {
    if (config.freeTierEnabled && config.provisionFreeOnRegistration) {
      await ensureFreeTierKey({
        client,
        db: options.db,
        userId: options.userId,
        config,
      });
    } else {
      await provisionUserKey({
        client,
        db: options.db,
        userId: options.userId,
        config,
        keyLimitMicroUsd: 0,
        expiresAt: null,
      });
    }
    return { provisioned: true, skipped: false };
  } catch (error) {
    options.logger?.warn(
      '[Surveil] Registration provisioning failed; endpoint initialization will retry:',
      error instanceof Error ? error.message : error,
    );
    return { provisioned: false, skipped: false };
  }
}
