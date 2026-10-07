import type { OpenRouterApiKey, OpenRouterClient } from './openrouter/client';
import type { ResolvedSurvielConfig } from './config';
import { openRouterKeyName, openRouterKeyPrefix } from './config';
import { requireGuardrails } from './openrouter/guardrails';

/** The subset of the encrypted user-key store that provisioning needs. */
export interface SurvielKeyStore {
  getUserKey(params: { userId: string; name: string }): Promise<string>;
  updateUserKey(params: {
    userId: string;
    name: string;
    value: string;
    expiresAt?: Date | null;
  }): Promise<unknown>;
  deleteUserKey(params: { userId: string; name?: string; all?: boolean }): Promise<unknown>;
}

export interface ProvisionedTier {
  tier: number;
  endpoint: string;
  keyName: string;
  keyHash: string;
  created: boolean;
  rotated: boolean;
}

export interface ProvisionResult {
  userId: string;
  tiers: ProvisionedTier[];
}

async function hasStoredKey(db: SurvielKeyStore, userId: string, name: string): Promise<boolean> {
  try {
    const value = await db.getUserKey({ userId, name });
    return typeof value === 'string' && value.length > 0;
  } catch {
    return false;
  }
}

/**
 * Idempotently provision one OpenRouter key per tier for a user, store each plaintext key in
 * the encrypted user-key store under its endpoint name, and assign each key to its tier's
 * guardrail. Retry-safe: a key that exists remotely but not in the store is rotated; a
 * created key is reassigned on retry.
 */
export async function provisionUserKeys(options: {
  client: OpenRouterClient;
  db: SurvielKeyStore;
  userId: string;
  config: ResolvedSurvielConfig;
}): Promise<ProvisionResult> {
  const { client, db, userId, config } = options;
  const guardrails = await requireGuardrails({ client });
  const allKeys = await client.listAllKeys();
  const byName = new Map<string, OpenRouterApiKey>(allKeys.map((key) => [key.name, key]));

  const tiers: ProvisionedTier[] = [];

  for (const tier of config.tiers) {
    const keyName = openRouterKeyName(userId, tier.tier);
    const guardrail = guardrails[tier.tier];
    const stored = await hasStoredKey(db, userId, tier.endpoint);
    let existing = byName.get(keyName);
    let created = false;
    let rotated = false;

    if (existing && !stored) {
      // The remote key exists but we cannot recover its plaintext: rotate it.
      await client.deleteKey(existing.hash);
      existing = undefined;
      rotated = true;
    }

    if (!existing) {
      const result = await client.createKey({ name: keyName, limit: 0, limit_reset: null });
      await db.updateUserKey({
        userId,
        name: tier.endpoint,
        value: JSON.stringify({ apiKey: result.key }),
      });
      existing = result.data;
      created = true;
    }

    await client.assignKeysToGuardrail(guardrail.id, [existing.hash]);

    tiers.push({
      tier: tier.tier,
      endpoint: tier.endpoint,
      keyName,
      keyHash: existing.hash,
      created,
      rotated,
    });
  }

  return { userId, tiers };
}

/** Enable or disable every OpenRouter key belonging to a user. Returns the count changed. */
export async function setUserKeysDisabled(options: {
  client: OpenRouterClient;
  userId: string;
  disabled: boolean;
}): Promise<{ changed: number }> {
  const { client, userId, disabled } = options;
  const prefix = openRouterKeyPrefix(userId);
  const allKeys = await client.listAllKeys();
  const mine = allKeys.filter((key) => key.name.startsWith(prefix) && key.disabled !== disabled);
  for (const key of mine) {
    await client.updateKey(key.hash, { disabled });
  }
  return { changed: mine.length };
}

/**
 * Delete every OpenRouter key belonging to a user and remove the matching encrypted keys.
 * Best-effort per key so one failure does not strand the rest.
 */
export async function deprovisionUserKeys(options: {
  client: OpenRouterClient;
  db: SurvielKeyStore;
  userId: string;
  config: ResolvedSurvielConfig;
}): Promise<{ deleted: number }> {
  const { client, db, userId, config } = options;
  const prefix = openRouterKeyPrefix(userId);
  const allKeys = await client.listAllKeys();
  const mine = allKeys.filter((key) => key.name.startsWith(prefix));

  let deleted = 0;
  for (const key of mine) {
    await client.deleteKey(key.hash);
    deleted += 1;
  }

  for (const tier of config.tiers) {
    await db.deleteUserKey({ userId, name: tier.endpoint });
  }

  return { deleted };
}
