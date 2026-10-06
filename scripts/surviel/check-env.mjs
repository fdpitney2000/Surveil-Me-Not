#!/usr/bin/env node
/**
 * Reports set/unset per required Surviel environment variable without printing values.
 * Exits non-zero when a required variable is missing or empty.
 */
import { loadEnvFile, envStatus, envPath } from './lib/env.mjs';

/** Variables that must be present for the subscription/tier stack to function. */
const REQUIRED = ['OPENROUTER_MANAGEMENT_KEY', 'STRIPE_SECRET_KEY'];

/** Plan price IDs are required for checkout; report but do not fail the base check. */
const RECOMMENDED = ['STRIPE_PRICE_50_ID', 'STRIPE_PRICE_100_ID', 'STRIPE_PRICE_200_ID'];

function resolveWebhookSecretKey(env) {
  const source = (env.get('SURVIEL_STRIPE_WEBHOOK_SOURCE') ?? '').toLowerCase();
  if (source === 'cli') return ['STRIPE_WEBHOOK_SECRET_LOCAL', true];
  if (source === 'dashboard') return ['STRIPE_WEBHOOK_SECRET', true];
  // No explicit source: either secret satisfies the check, but flag if neither is set.
  const hasLocal = envStatus(env, 'STRIPE_WEBHOOK_SECRET_LOCAL') === 'SET';
  const hasDash = envStatus(env, 'STRIPE_WEBHOOK_SECRET') === 'SET';
  return [
    hasLocal ? 'STRIPE_WEBHOOK_SECRET_LOCAL' : 'STRIPE_WEBHOOK_SECRET',
    !hasLocal && !hasDash,
  ];
}

const env = loadEnvFile();
console.log(`Surviel environment check (${envPath})`);
console.log('Values are never printed; only presence is reported.\n');

const [webhookKey, webhookMissing] = resolveWebhookSecretKey(env);

const required = [...REQUIRED, webhookKey];
const missing = [];

for (const key of required) {
  const status = envStatus(env, key);
  const ok = status === 'SET';
  if (!ok) missing.push(key);
  console.log(`  ${ok ? '[SET]  ' : '[MISS] '} ${key} (${status})`);
}

console.log('');
for (const key of RECOMMENDED) {
  const status = envStatus(env, key);
  console.log(`  ${status === 'SET' ? '[SET]  ' : '[WARN] '} ${key} (${status})`);
}

if (webhookMissing) {
  console.log('\nNote: no Stripe webhook secret is set. Set STRIPE_WEBHOOK_SECRET (dashboard)');
  console.log('or run `npm run surviel:stripe-local-secret` for the CLI forwarder.');
}

if (missing.length > 0) {
  console.error(`\nMissing required variables: ${missing.join(', ')}`);
  process.exit(1);
}

console.log('\nAll required variables are set.');
