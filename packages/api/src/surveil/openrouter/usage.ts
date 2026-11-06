import type { OpenRouterApiKey, OpenRouterClient } from './client';
import { isOpenRouterKeyForUser, openRouterKeyName } from '../config';
import { usdToMicro } from '../money';

export interface UserKeyUsage {
  hash: string;
  name: string;
  disabled: boolean;
  usageUsd: number;
  createdAt: string;
  expiresAt?: string | null;
}

export interface UserUsage {
  /** Cumulative usage across the user's current key and any legacy keys. */
  usageUsd: number;
  usageMicro: number;
  keys: UserKeyUsage[];
}

/**
 * Fetch the user's OpenRouter keys and cumulative usage in one listing. The single-key
 * model creates one remote key per customer, but legacy per-tier keys remain visible so
 * they can be disabled and cleaned up.
 */
export async function fetchUserUsage(options: {
  client: OpenRouterClient;
  userId: string;
}): Promise<UserUsage> {
  const { client, userId } = options;
  const all: OpenRouterApiKey[] = await client.listAllKeys();
  const mine = all.filter((key) => isOpenRouterKeyForUser(key.name, userId));
  const currentName = openRouterKeyName(userId);
  const currentKeys = mine.filter((key) => key.name === currentName);
  const usageKeys = currentKeys.length > 0 ? currentKeys : mine;

  let usageUsd = 0;
  const keys: UserKeyUsage[] = [];
  for (const key of usageKeys) {
    usageUsd += key.usage;
  }
  for (const key of mine) {
    keys.push({
      hash: key.hash,
      name: key.name,
      disabled: key.disabled,
      usageUsd: key.usage,
      createdAt: key.created_at,
      expiresAt: key.expires_at ?? null,
    });
  }

  return { usageUsd, usageMicro: usdToMicro(usageUsd), keys };
}
