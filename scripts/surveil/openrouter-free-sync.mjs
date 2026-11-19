#!/usr/bin/env node
/**
 * Refresh the `surveil:free` guardrail from the current OpenRouter catalog and assign
 * every per-user free-tier key to it.
 *
 * Usage: node scripts/surveil/openrouter-free-sync.mjs
 */
import { openRouterClient, api } from './lib/runtime.mjs';
import { freeTierAllowedIds } from './lib/free-model-catalog.mjs';

const FREE_GUARDRAIL = 'surveil:free';
const client = openRouterClient(api());

const models = await client.listModels();
const allowedModels = freeTierAllowedIds(models);
if (allowedModels.length === 0) {
  console.error('No eligible free-tier OpenRouter models found; refusing to empty the guardrail.');
  process.exit(1);
}

const guardrails = await client.listGuardrails();
const existing = guardrails.find((entry) => entry.name === FREE_GUARDRAIL);
const body = {
  name: FREE_GUARDRAIL,
  /** The per-key $2 limit is authoritative; no second guardrail cap. */
  limit_usd: null,
  reset_interval: null,
  allowed_models: allowedModels,
};
const guardrail = existing
  ? await client.updateGuardrail(existing.id, body)
  : await client.createGuardrail(body);

const keys = await client.listAllKeys();
const freeKeys = keys.filter((entry) => entry.name.startsWith('surveil:free:'));
if (freeKeys.length > 0) {
  await client.assignKeysToGuardrail(
    guardrail.id,
    freeKeys.map((entry) => entry.hash),
  );
}

console.log(
  `Synced ${FREE_GUARDRAIL}: ${allowedModels.length} eligible models; ${freeKeys.length} free keys assigned.`,
);
console.log(`  guardrail=${guardrail.id}`);
