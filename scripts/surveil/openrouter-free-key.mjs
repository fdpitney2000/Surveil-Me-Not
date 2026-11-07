#!/usr/bin/env node
/**
 * Create the shared free-tier OpenRouter key and its free-model guardrail, then write the
 * key to .env without printing it. Idempotent when SURVEIL_FREE_OPENROUTER_KEY is already set.
 *
 * Usage: node scripts/surveil/openrouter-free-key.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { openRouterClient, api } from './lib/runtime.mjs';
import { repoRoot } from './lib/env.mjs';

const FREE_GUARDRAIL = 'surveil:free';
const FREE_KEY_NAME = 'surveil:free';

if (process.env.SURVEIL_FREE_OPENROUTER_KEY?.trim()) {
  console.log('SURVEIL_FREE_OPENROUTER_KEY is already set in .env; nothing to do.');
  process.exit(0);
}

const apiModule = api();
const client = openRouterClient(apiModule);

const models = await client.listModels();
const freeModelIds = models
  .filter((model) => {
    if (model.id.endsWith(':free')) return true;
    return model.pricing?.prompt === '0' && model.pricing?.completion === '0';
  })
  .map((model) => model.id);

if (freeModelIds.length === 0) {
  console.error('No free OpenRouter models found; refusing to create the shared key.');
  process.exit(1);
}

const existingGuardrails = await client.listGuardrails();
let guardrail = existingGuardrails.find((entry) => entry.name === FREE_GUARDRAIL);
const guardrailBody = {
  name: FREE_GUARDRAIL,
  limit_usd: 1,
  reset_interval: 'monthly',
  allowed_models: freeModelIds,
};

guardrail = guardrail
  ? await client.updateGuardrail(guardrail.id, guardrailBody)
  : await client.createGuardrail(guardrailBody);

/** A remote key with this name but no plaintext in .env is unusable; rotate it. */
const existingKeys = await client.listAllKeys();
for (const key of existingKeys.filter((entry) => entry.name === FREE_KEY_NAME)) {
  await client.deleteKey(key.hash);
}

const created = await client.createKey({
  name: FREE_KEY_NAME,
  limit: 1,
  limit_reset: null,
});

await client.assignKeysToGuardrail(guardrail.id, [created.data.hash]);

const envPath = path.join(repoRoot, '.env');
const env = fs.readFileSync(envPath, 'utf8');
const line = `SURVEIL_FREE_OPENROUTER_KEY=${created.key}`;
if (/^SURVEIL_FREE_OPENROUTER_KEY=.*$/m.test(env)) {
  fs.writeFileSync(envPath, env.replace(/^SURVEIL_FREE_OPENROUTER_KEY=.*$/m, line));
} else {
  fs.writeFileSync(envPath, `${env.replace(/\s*$/, '')}\n${line}\n`);
}

console.log(`Created ${FREE_KEY_NAME} with ${freeModelIds.length} free models.`);
console.log(`  guardrail=${guardrail.id} hash=${created.data.hash.slice(0, 8)}…`);
console.log('The plaintext key was written to .env and was not printed.');
