#!/usr/bin/env node
/**
 * Refresh the shared `surveil:free` guardrail from the current OpenRouter catalog
 * without rotating the free key. Run after OpenRouter adds or renames free models.
 *
 * Usage: node scripts/surveil/openrouter-free-sync.mjs
 */
import { openRouterClient, api } from './lib/runtime.mjs';
import { freeModelAllowedIds } from './lib/free-model-catalog.mjs';

const FREE_GUARDRAIL = 'surveil:free';
const FREE_KEY_NAME = 'surveil:free';

const client = openRouterClient(api());
const models = await client.listModels();
const allowedModels = freeModelAllowedIds(models);
if (allowedModels.length === 0) {
  console.error('No free text-chat OpenRouter models found; refusing to empty the guardrail.');
  process.exit(1);
}

const guardrails = await client.listGuardrails();
const existing = guardrails.find((entry) => entry.name === FREE_GUARDRAIL);
if (!existing) {
  console.error(`Guardrail ${FREE_GUARDRAIL} does not exist; run surveil:openrouter-free-key first.`);
  process.exit(1);
}

const guardrail = await client.updateGuardrail(existing.id, {
  name: FREE_GUARDRAIL,
  limit_usd: existing.limit_usd ?? 1,
  reset_interval: existing.reset_interval ?? 'monthly',
  allowed_models: allowedModels,
});

const keys = await client.listAllKeys();
const key = keys.find((entry) => entry.name === FREE_KEY_NAME);
if (!key) {
  console.error(`Key ${FREE_KEY_NAME} does not exist; run surveil:openrouter-free-key first.`);
  process.exit(1);
}

await client.assignKeysToGuardrail(guardrail.id, [key.hash]);
console.log(
  `Synced ${FREE_GUARDRAIL}: ${allowedModels.length} allowed ids across the current free text-chat catalog.`,
);
console.log(`  guardrail=${guardrail.id} key=${key.hash.slice(0, 8)}…`);
