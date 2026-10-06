#!/usr/bin/env node
/**
 * Provision (or repair) the three per-tier OpenRouter keys for a user, store each plaintext
 * key in the encrypted user-key store, and assign it to its tier guardrail.
 * Usage: npm run surviel:openrouter-provision -- <userId>
 * Output is redacted: key strings never reach stdout.
 */
import { openRouterClient, survielConfig, api, connectDb } from './lib/runtime.mjs';

const userId = process.argv[2];
if (!userId) {
  console.error('Usage: npm run surviel:openrouter-provision -- <userId>');
  process.exit(1);
}

const apiModule = api();
const client = openRouterClient(apiModule);
const config = survielConfig(apiModule);
const { mongoose, db } = await connectDb();

try {
  const result = await apiModule.provisionUserKeys({ client, db, userId, config });
  console.log(`Provisioned ${result.tiers.length} key(s) for user ${userId}:`);
  for (const tier of result.tiers) {
    let action = 'verified';
    if (tier.created) action = 'created';
    else if (tier.rotated) action = 'rotated';
    console.log(
      `  tier ${tier.tier} (${tier.endpoint}): ${action}, hash=${tier.keyHash.slice(0, 8)}…`,
    );
  }
} finally {
  await mongoose.disconnect();
}
