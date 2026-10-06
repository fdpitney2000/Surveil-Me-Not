import type { TSurvielConfig } from 'librechat-data-provider';
import type { SurvielKeyStore } from './provision';
import { createOpenRouterClientFromEnv } from './openrouter/client';
import { deprovisionUserKeys } from './provision';
import { resolveSurvielConfig } from './config';

/**
 * Best-effort cleanup of a deleted user's OpenRouter keys. A missing management key or a
 * disabled Surviel config is a no-op, so stock deployments and account deletion keep working.
 */
export async function deleteUserSurvielKeys(options: {
  db: SurvielKeyStore;
  userId: string;
  rawConfig?: Partial<TSurvielConfig>;
}): Promise<{ deleted: number; skipped: boolean }> {
  const config = resolveSurvielConfig(options.rawConfig);
  if (!config.enabled) return { deleted: 0, skipped: true };
  const client = createOpenRouterClientFromEnv();
  if (!client) return { deleted: 0, skipped: true };

  const { deleted } = await deprovisionUserKeys({
    client,
    db: options.db,
    userId: options.userId,
    config,
  });
  return { deleted, skipped: false };
}
