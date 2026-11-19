import type { OpenRouterClient, OpenRouterGuardrail } from './openrouter/client';
import type { ResolvedSurveilConfig } from './config';
import type { SurveilKeyStore } from './provision';
import { freeOpenRouterKeyName } from './config';
import { SurveilError, SurveilErrorCodes } from './errors';
import { selectFreeTierModelIds } from './free-models';

/** The guardrail shared by every subsidized free-tier key. */
export const FREE_TIER_GUARDRAIL_NAME = 'surveil:free';

const GUARDRAIL_TTL_MS = 5 * 60 * 1000;
const GLOBAL_USAGE_TTL_MS = 30 * 1000;

interface GuardrailCache {
  id: string;
  modelIds: string[];
  expiresAt: number;
}

interface UsageCache {
  usedUsd: number;
  expiresAt: number;
}

let guardrailCache: GuardrailCache | null = null;
let usageCache: UsageCache | null = null;

/** Tests and config reloads can clear the short-lived OpenRouter caches. */
export function resetFreeTierCaches(): void {
  guardrailCache = null;
  usageCache = null;
}

export function isFreeTierKeyName(name: string): boolean {
  return name.startsWith('surveil:free:');
}

export function isStoredFreeKey(value: { surveilFree?: boolean } | null | undefined): boolean {
  return value?.surveilFree === true;
}

function freePolicy(config: ResolvedSurveilConfig) {
  return {
    maxModels: config.freeTierMaxModels,
    maxOutputPricePerMillionUsd: config.freeTierMaxOutputPricePerMillionUsd,
    maxAgeDays: config.freeTierMaxAgeDays,
    pinnedModel: config.freeTierPinnedModel,
  };
}

/** Sum current-calendar-month usage across every free-tier key. */
export async function fetchFreeTierUsage(client: OpenRouterClient): Promise<number> {
  const now = Date.now();
  if (usageCache && usageCache.expiresAt > now) {
    return usageCache.usedUsd;
  }
  const keys = await client.listAllKeys();
  const usedUsd = keys
    .filter((key) => isFreeTierKeyName(key.name))
    .reduce((sum, key) => sum + Number(key.usage_monthly ?? key.usage ?? 0), 0);
  usageCache = { usedUsd, expiresAt: now + GLOBAL_USAGE_TTL_MS };
  return usedUsd;
}

/**
 * The global ceiling is a circuit breaker, not per-user accounting: each key's
 * own $2 limit prevents individual overages, and this check stops the whole
 * free pool at $10/month.
 */
export async function assertFreeTierAvailable(options: {
  client: OpenRouterClient;
  config: ResolvedSurveilConfig;
}): Promise<void> {
  if (!options.config.freeTierEnabled) {
    throw new SurveilError(
      SurveilErrorCodes.FREE_TIER_UNAVAILABLE,
      'The subsidized free tier is disabled.',
      403,
    );
  }
  const usedUsd = await fetchFreeTierUsage(options.client);
  if (usedUsd >= options.config.freeTierGlobalUsd) {
    /**
     * The message is a typed payload as well as prose: the client localizes the type and older
     * clients still show the sentence. The Surveil code is retained for server-side handling.
     */
    throw new SurveilError(
      SurveilErrorCodes.FREE_TIER_EXHAUSTED,
      JSON.stringify({
        type: 'surveil_free_tier_exhausted',
        message: 'Free capacity reached; try next month.',
      }),
      429,
    );
  }
}

async function resolveFreeGuardrail(options: {
  client: OpenRouterClient;
  config: ResolvedSurveilConfig;
}): Promise<OpenRouterGuardrail> {
  const now = Date.now();
  if (guardrailCache && guardrailCache.expiresAt > now) {
    const existing = (await options.client.listGuardrails()).find(
      (entry) => entry.id === guardrailCache?.id,
    );
    if (existing) return existing;
    guardrailCache = null;
  }

  const models = await options.client.listModels();
  const modelIds = selectFreeTierModelIds(models, freePolicy(options.config));
  if (modelIds.length === 0) {
    throw new SurveilError(
      SurveilErrorCodes.FREE_TIER_UNAVAILABLE,
      'No eligible free-tier models are available.',
      503,
    );
  }

  const existing = (await options.client.listGuardrails()).find(
    (entry) => entry.name === FREE_TIER_GUARDRAIL_NAME,
  );
  const body = {
    name: FREE_TIER_GUARDRAIL_NAME,
    allowed_models: modelIds,
    /** The per-key limit is authoritative; keep the guardrail from adding a second cap. */
    limit_usd: null,
    reset_interval: null,
  };

  const guardrail = existing
    ? await options.client.updateGuardrail(existing.id, body)
    : await options.client.createGuardrail(body);
  guardrailCache = {
    id: guardrail.id,
    modelIds,
    expiresAt: now + GUARDRAIL_TTL_MS,
  };
  return guardrail;
}

async function readStoredKey(
  db: SurveilKeyStore,
  userId: string,
  config: ResolvedSurveilConfig,
): Promise<string | undefined> {
  for (const tier of config.tiers) {
    try {
      const raw = await db.getUserKey({ userId, name: tier.endpoint });
      const parsed = JSON.parse(raw) as { apiKey?: string; surveilFree?: boolean };
      if (parsed.apiKey) return parsed.apiKey;
    } catch {
      /* Try the next endpoint; a partial store is repaired below. */
    }
  }
  return undefined;
}

async function storeFreeKey(options: {
  db: SurveilKeyStore;
  userId: string;
  apiKey: string;
  config: ResolvedSurveilConfig;
}): Promise<void> {
  const value = JSON.stringify({ apiKey: options.apiKey, surveilFree: true });
  for (const tier of options.config.tiers) {
    await options.db.updateUserKey({
      userId: options.userId,
      name: tier.endpoint,
      value,
      expiresAt: null,
    });
  }
}

/**
 * Ensure a user has one $2/month free key. The key resets at midnight UTC on the
 * first of each calendar month; no key rotation is required. Returns the plaintext
 * key only for immediate server-side use; it is never sent to the browser.
 */
export async function ensureFreeTierKey(options: {
  client: OpenRouterClient;
  db: SurveilKeyStore;
  userId: string;
  config: ResolvedSurveilConfig;
}): Promise<{ apiKey: string; created: boolean; keyHash?: string }> {
  const { client, db, userId, config } = options;
  if (!config.freeTierEnabled) {
    throw new SurveilError(
      SurveilErrorCodes.FREE_TIER_UNAVAILABLE,
      'The subsidized free tier is disabled.',
      403,
    );
  }

  const keyName = freeOpenRouterKeyName(userId);
  const allKeys = await client.listAllKeys();
  const current = allKeys.find((key) => key.name === keyName && !key.disabled);
  const stored = await readStoredKey(db, userId, config);

  if (current && stored) {
    return { apiKey: stored, created: false, keyHash: current.hash };
  }

  await assertFreeTierAvailable({ client, config });
  const guardrail = await resolveFreeGuardrail({ client, config });
  const created = await client.createKey({
    name: keyName,
    limit: config.freeTierMonthlyUsd,
    limit_reset: 'monthly',
    expires_at: null,
  });
  await client.assignKeysToGuardrail(guardrail.id, [created.data.hash]);

  for (const old of allKeys.filter((key) => key.name === keyName && key.hash !== created.data.hash)) {
    try {
      await client.deleteKey(old.hash);
    } catch {
      /* The old key expires on its own; do not fail a working free key over cleanup. */
    }
  }

  await storeFreeKey({ db, userId, apiKey: created.key, config });
  usageCache = null;
  return { apiKey: created.key, created: true, keyHash: created.data.hash };
}

/** Best-effort free-key removal when a subscription takes over. */
export async function deleteFreeTierKeys(options: {
  client: OpenRouterClient;
  db: SurveilKeyStore;
  userId: string;
  config: ResolvedSurveilConfig;
}): Promise<{ deleted: number }> {
  const allKeys = await options.client.listAllKeys();
  const mine = allKeys.filter((key) => key.name === freeOpenRouterKeyName(options.userId));
  for (const key of mine) {
    await options.client.deleteKey(key.hash);
  }
  return { deleted: mine.length };
}
