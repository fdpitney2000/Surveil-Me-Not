#!/usr/bin/env node
/**
 * Provision (or rotate) the single OpenRouter key for a user, store its plaintext under
 * every tier endpoint, and set its period limit/expiry.
 * Usage: npm run surveil:openrouter-provision -- <userId> [limitUSD] [expiresAtISO]
 * Output is redacted: key strings never reach stdout.
 */
import { openRouterClient, surveilConfig, api, connectDb } from './lib/runtime.mjs';

const userId = process.argv[2];
if (!userId) {
  console.error(
    'Usage: npm run surveil:openrouter-provision -- <userId> [limitUSD] [expiresAtISO]',
  );
  process.exit(1);
}

const limitUsd = Number(process.argv[3] ?? 0);
if (!Number.isFinite(limitUsd) || limitUsd < 0) {
  console.error('limitUSD must be a non-negative number.');
  process.exit(1);
}
const expiresRaw = process.argv[4];
const expiresAt = expiresRaw ? new Date(expiresRaw) : null;
if (expiresAt && Number.isNaN(expiresAt.getTime())) {
  console.error('expiresAtISO must be a valid ISO date.');
  process.exit(1);
}

const apiModule = api();
const client = openRouterClient(apiModule);
const config = surveilConfig(apiModule);
const { mongoose, db } = await connectDb();

try {
  const result = await apiModule.provisionUserKey({
    client,
    db,
    userId,
    config,
    keyLimitMicroUsd: Math.round(limitUsd * 1_000_000),
    expiresAt,
    rotate: true,
  });
  const key = result.key;
  if (!key) {
    console.error('No key was provisioned.');
    process.exitCode = 1;
  } else {
    const action = key.rotated ? 'rotated' : key.created ? 'created' : 'verified';
    console.log(`Provisioned key ${key.keyName} for user ${userId}: ${action}.`);
    console.log(`  limit=$${limitUsd.toFixed(2)} expires=${expiresAt?.toISOString() ?? 'never'}`);
    console.log(`  hash=${key.keyHash.slice(0, 8)}…`);
  }
} finally {
  await mongoose.disconnect();
}
