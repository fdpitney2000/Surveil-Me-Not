#!/usr/bin/env node
/**
 * Reports set/unset per required Surviel environment variable without printing values.
 * Exits non-zero when a required variable is missing or empty.
 */
import { loadEnvFile, envStatus, envPath, commentedKeys } from './lib/env.mjs';

/** Variables that must be present for the subscription/tier stack to function. */
const REQUIRED = ['OPENROUTER_MANAGEMENT_KEY', 'STRIPE_SECRET_KEY'];

/** Accepted alternative names; the canonical name above is preferred. */
const ALIASES = {
  OPENROUTER_MANAGEMENT_KEY: ['OPENROUTER_MANAGEMENT_API_KEY'],
};

/** Plan price IDs are required for checkout; report but do not fail the base check. */
const RECOMMENDED = ['STRIPE_PRICE_50_ID', 'STRIPE_PRICE_100_ID', 'STRIPE_PRICE_200_ID'];

/** Resolve a variable or its alias, returning the name that is set. */
function resolveStatus(env, key) {
  if (envStatus(env, key) === 'SET') return { name: key, status: 'SET' };
  for (const alias of ALIASES[key] ?? []) {
    if (envStatus(env, alias) === 'SET') return { name: alias, status: 'SET' };
  }
  return { name: key, status: envStatus(env, key) };
}

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
const commented = commentedKeys();
console.log(`Surviel environment check (${envPath})`);
console.log('Values are never printed; only presence is reported.\n');

const [webhookKey, webhookMissing] = resolveWebhookSecretKey(env);

const required = [...REQUIRED, webhookKey];
const missing = [];

for (const key of required) {
  const { name, status } = resolveStatus(env, key);
  const ok = status === 'SET';
  if (!ok) missing.push(key);
  const viaAlias = ok && name !== key ? ` via ${name}` : '';
  const isCommented =
    !ok && [key, ...(ALIASES[key] ?? [])].some((candidate) => commented.has(candidate));
  let label = '[MISS] ';
  if (ok) label = '[SET]  ';
  else if (isCommented) label = '[COMMENTED]';
  console.log(`  ${label} ${key} (${status}${viaAlias})`);
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

const commentedRequired = required.filter((key) => {
  const { status } = resolveStatus(env, key);
  return status !== 'SET' && [key, ...(ALIASES[key] ?? [])].some((c) => commented.has(c));
});
if (commentedRequired.length > 0) {
  console.log(
    `\nNote: these are present but commented out in .env; remove the leading '#' to activate: ${commentedRequired.join(', ')}`,
  );
}

if (missing.length > 0) {
  console.error(`\nMissing required variables: ${missing.join(', ')}`);
  process.exit(1);
}

console.log('\nAll required variables are set.');
