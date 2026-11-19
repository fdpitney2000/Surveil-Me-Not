#!/usr/bin/env node
/**
 * Ensure the `surveil:free` guardrail exists and contains the current eligible
 * paid-model catalog. Per-user keys are created lazily by the application; this script
 * no longer creates a shared key or writes any secret to .env.
 *
 * Usage: node scripts/surveil/openrouter-free-key.mjs
 */
import { openRouterClient, api } from './lib/runtime.mjs';
import { freeTierAllowedIds } from './lib/free-model-catalog.mjs';

const FREE_GUARDRAIL = 'surveil:free';
const client = openRouterClient(api());

const models = await client.listModels();
const allowedModels = freeTierAllowedIds(models);
if (allowedModels.length === 0) {
  console.error('No eligible free-tier OpenRouter models found; refusing to create the guardrail.');
  process.exit(1);
}

const existing = (await client.listGuardrails()).find((entry) => entry.name === FREE_GUARDRAIL);
const body = {
  name: FREE_GUARDRAIL,
  limit_usd: null,
  reset_interval: null,
  allowed_models: allowedModels,
};
const guardrail = existing
  ? await client.updateGuardrail(existing.id, body)
  : await client.createGuardrail(body);

console.log(`Ensured ${FREE_GUARDRAIL} with ${allowedModels.length} eligible models.`);
console.log(`  guardrail=${guardrail.id}`);
console.log('No shared key was created; free keys are provisioned per user by the app.');
