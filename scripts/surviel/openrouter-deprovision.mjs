#!/usr/bin/env node
/**
 * Delete every OpenRouter key belonging to a user and remove the matching encrypted keys.
 * Usage: npm run surviel:openrouter-deprovision -- <userId>
 * Output is redacted: no key material is printed.
 */
import { openRouterClient, survielConfig, api, connectDb } from './lib/runtime.mjs';

const userId = process.argv[2];
if (!userId) {
  console.error('Usage: npm run surviel:openrouter-deprovision -- <userId>');
  process.exit(1);
}

const apiModule = api();
const client = openRouterClient(apiModule);
const config = survielConfig(apiModule);
const { mongoose, db } = await connectDb();

try {
  const result = await apiModule.deprovisionUserKeys({ client, db, userId, config });
  console.log(`Deleted ${result.deleted} OpenRouter key(s) for user ${userId}.`);
} finally {
  await mongoose.disconnect();
}
