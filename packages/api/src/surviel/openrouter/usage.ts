import type { OpenRouterApiKey, OpenRouterClient } from './client';
import type { TierUsageMicro } from '../period';
import { openRouterKeyPrefix } from '../config';
import { tierUsageFromUsd } from '../period';

/** Parse a key name (`surviel:{userId}:{tier}`) into a tier number. */
export function tierFromKeyName(name: string, userId: string): number | undefined {
  const prefix = openRouterKeyPrefix(userId);
  if (!name.startsWith(prefix)) return undefined;
  const tier = Number(name.slice(prefix.length));
  return Number.isInteger(tier) ? tier : undefined;
}

export interface UserKeyUsage {
  tier: number;
  hash: string;
  disabled: boolean;
  usageUsd: number;
}

export interface UserUsage {
  usage: TierUsageMicro;
  keys: UserKeyUsage[];
}

/** Fetch per-tier lifetime usage for a user's keys in one listing. */
export async function fetchUserUsage(options: {
  client: OpenRouterClient;
  userId: string;
}): Promise<UserUsage> {
  const { client, userId } = options;
  const prefix = openRouterKeyPrefix(userId);
  const all: OpenRouterApiKey[] = await client.listAllKeys();
  const mine = all.filter((key) => key.name.startsWith(prefix));

  const usd = { tier1: 0, tier2: 0, tier3: 0 };
  const keys: UserKeyUsage[] = [];
  for (const key of mine) {
    const tier = tierFromKeyName(key.name, userId);
    if (tier == null) continue;
    if (tier === 1) usd.tier1 += key.usage;
    else if (tier === 2) usd.tier2 += key.usage;
    else if (tier === 3) usd.tier3 += key.usage;
    keys.push({ tier, hash: key.hash, disabled: key.disabled, usageUsd: key.usage });
  }
  return { usage: tierUsageFromUsd(usd), keys };
}
