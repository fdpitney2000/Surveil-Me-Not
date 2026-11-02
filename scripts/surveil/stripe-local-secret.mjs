#!/usr/bin/env node
/**
 * Runs `stripe listen --print-secret` and writes the result to STRIPE_WEBHOOK_SECRET_LOCAL
 * in .env. The secret is never printed. TEST mode only (the CLI's current login).
 */
import { spawnSync } from 'node:child_process';
import { upsertEnvVar, loadEnvFile, envStatus, envPath } from './lib/env.mjs';

const result = spawnSync('stripe', ['listen', '--print-secret'], {
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'pipe'],
});

if (result.error) {
  console.error('Failed to run the Stripe CLI. Is it installed and on PATH?');
  console.error(result.error.message);
  process.exit(1);
}

if (result.status !== 0) {
  console.error('`stripe listen --print-secret` failed.');
  const stderr = (result.stderr ?? '').trim();
  if (stderr) console.error(stderr);
  process.exit(1);
}

const secret = (result.stdout ?? '').trim().split(/\s+/).pop() ?? '';
if (!/^whsec_[A-Za-z0-9]+$/.test(secret)) {
  console.error('Stripe CLI did not return a valid webhook signing secret.');
  process.exit(1);
}

upsertEnvVar('STRIPE_WEBHOOK_SECRET_LOCAL', secret);
console.log(
  `Wrote STRIPE_WEBHOOK_SECRET_LOCAL to ${envPath} (${secret.length} chars, value hidden).`,
);

const env = loadEnvFile();
console.log(`STRIPE_WEBHOOK_SECRET_LOCAL is now ${envStatus(env, 'STRIPE_WEBHOOK_SECRET_LOCAL')}.`);
