#!/usr/bin/env node
/**
 * Verify the OpenRouter management key works and report expiry. Output is redacted:
 * account credit totals are shown, never key material.
 */
import { openRouterClient, survielConfig, api } from './lib/runtime.mjs';

const apiModule = api();
const client = openRouterClient(apiModule);
const config = survielConfig(apiModule);

const credits = await client.getCredits();
console.log('OpenRouter management key is valid.');
console.log(`  account total_credits: ${credits.total_credits}`);
console.log(`  account total_usage:   ${credits.total_usage}`);

const warning = apiModule.envManagementKeyExpiryWarning(config.mgmtKeyWarnDays);
if (warning) {
  console.warn(`WARNING: ${warning.message}`);
} else {
  console.log('  expiry: none within the warning window (or not configured).');
}
