import type { OpenRouterApiKey, OpenRouterClient } from './openrouter/client';
import type { ResolvedSurveilConfig } from './config';
import { isOpenRouterKeyForUser, openRouterKeyName } from './config';
import { microToUsd } from './money';

/** The subset of the encrypted user-key store that provisioning needs. */
export interface SurveilKeyStore {
  getUserKey(params: { userId: string; name: string }): Promise<string>;
  updateUserKey(params: {
    userId: string;
    name: string;
    value: string;
    expiresAt?: Date | null;
  }): Promise<unknown>;
  deleteUserKey(params: { userId: string; name?: string; all?: boolean }): Promise<unknown>;
}

export interface ProvisionedKey {
  keyName: string;
  keyHash: string;
  created: boolean;
  rotated: boolean;
  expiresAt?: Date | null;
}

export interface ProvisionResult {
  userId: string;
  key: ProvisionedKey | null;
}

async function hasStoredKey(db: SurveilKeyStore, userId: string, name: string): Promise<boolean> {
  try {
    const value = await db.getUserKey({ userId, name });
    return typeof value === 'string' && value.length > 0;
  } catch {
    return false;
  }
}

/** True when every tier endpoint has a stored copy of the user's key. */
async function hasStoredKeyForAllEndpoints(
  db: SurveilKeyStore,
  userId: string,
  config: ResolvedSurveilConfig,
): Promise<boolean> {
  for (const tier of config.tiers) {
    if (!(await hasStoredKey(db, userId, tier.endpoint))) return false;
  }
  return true;
}

/**
 * Idempotently provision one OpenRouter key for a customer and store its plaintext under
 * every tier endpoint so all three custom endpoints resolve the same key. A new key is
 * created for a new paid period (which resets OpenRouter's per-key usage); a retry with
 * `rotate: false` only creates a key when one is missing.
 */
export async function provisionUserKey(options: {
  client: OpenRouterClient;
  db: SurveilKeyStore;
  userId: string;
  config: ResolvedSurveilConfig;
  keyLimitMicroUsd: number;
  expiresAt?: Date | null;
  rotate?: boolean;
}): Promise<ProvisionResult> {
  const { client, db, userId, config, keyLimitMicroUsd } = options;
  const keyName = openRouterKeyName(userId);
  const allKeys = await client.listAllKeys();
  const mine = allKeys.filter((key) => isOpenRouterKeyForUser(key.name, userId));
  const current = mine.find((key) => key.name === keyName);
  const stored = await hasStoredKeyForAllEndpoints(db, userId, config);
  const rotate = options.rotate ?? true;

  let key: OpenRouterApiKey | undefined;
  let created = false;
  let rotated = false;
  let plaintext: string | undefined;

  if (rotate || !current || !stored) {
    const result = await client.createKey({
      name: keyName,
      limit: microToUsd(keyLimitMicroUsd),
      limit_reset: null,
      expires_at: options.expiresAt ? options.expiresAt.toISOString() : null,
    });
    key = result.data;
    plaintext = result.key;
    created = true;
    rotated = mine.length > 0;

    /* Remove legacy per-tier keys and the previous period's key. Their usage must not
     * contaminate the new period's cumulative usage. */
    for (const old of mine) {
      if (old.hash === key.hash) continue;
      try {
        await client.deleteKey(old.hash);
      } catch {
        /* Best-effort: the reconciler disables leftovers and they expire on their own. */
      }
    }
  } else {
    key = current;
  }

  if (!key) return { userId, key: null };

  if (created && plaintext) {
    const value = JSON.stringify({ apiKey: plaintext });
    for (const tier of config.tiers) {
      await db.updateUserKey({
        userId,
        name: tier.endpoint,
        value,
        expiresAt: options.expiresAt ?? null,
      });
    }
  }

  return {
    userId,
    key: {
      keyName,
      keyHash: key.hash,
      created,
      rotated,
      expiresAt: options.expiresAt ?? null,
    },
  };
}

/** Enable or disable every OpenRouter key belonging to a user. Returns the count changed. */
export async function setUserKeysDisabled(options: {
  client: OpenRouterClient;
  userId: string;
  disabled: boolean;
}): Promise<{ changed: number }> {
  const { client, userId, disabled } = options;
  const allKeys = await client.listAllKeys();
  const mine = allKeys.filter(
    (key) => isOpenRouterKeyForUser(key.name, userId) && key.disabled !== disabled,
  );
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
  db: SurveilKeyStore;
  userId: string;
  config: ResolvedSurveilConfig;
}): Promise<{ deleted: number }> {
  const { client, db, userId, config } = options;
  const allKeys = await client.listAllKeys();
  const mine = allKeys.filter((key) => isOpenRouterKeyForUser(key.name, userId));

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
