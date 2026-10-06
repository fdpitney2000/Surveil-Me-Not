#!/usr/bin/env node
/**
 * Idempotently creates/converges the three tier guardrails, enables the organization's
 * filtered model catalog, and warns when the management key is near expiry.
 * Output is redacted: no key material is printed.
 */
import { openRouterClient, survielConfig, api } from './lib/runtime.mjs';

const apiModule = api();
const client = openRouterClient(apiModule);
const config = survielConfig(apiModule);

console.log('Bootstrapping OpenRouter guardrails (default workspace)...');
const guardrails = await apiModule.resolveGuardrails({ client, config });
for (const tier of [1, 2, 3]) {
  const guardrail = guardrails[tier];
  const zdr = tier === 3 ? ' + ZDR(anthropic/openai/google/xai/other)' : '';
  console.log(`  tier ${tier}: ${guardrail.name} (id=${guardrail.id})${zdr}`);
}

const catalog = await apiModule.enableFilteredModelCatalog({ client });
console.log(
  catalog.changed
    ? 'Enabled is_filtered_model_catalog_enabled.'
    : 'is_filtered_model_catalog_enabled already enabled.',
);

const warning = apiModule.envManagementKeyExpiryWarning(config.mgmtKeyWarnDays);
if (warning) {
  console.warn(`WARNING: ${warning.message}`);
}

console.log('Bootstrap complete.');
