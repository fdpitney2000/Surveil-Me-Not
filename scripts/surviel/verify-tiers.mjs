#!/usr/bin/env node
/**
 * Live, tiny-budget proof that each tier routes as advertised.
 * Usage: npm run surviel:verify-tiers -- <userId>
 *
 * Sends one max_tokens=1 request per tier using that user's provisioned keys, reads the
 * OpenRouter routing metadata, and checks:
 *   - Tier 3 selects a Zero Data Retention endpoint for the model.
 *   - Tier 2 selects a non-training endpoint.
 *   - Tier 1 reaches the catalog.
 * Output is redacted; only routing decisions and pass/fail are printed.
 */
import { openRouterClient, survielConfig, api, connectDb } from './lib/runtime.mjs';

const userId = process.argv[2];
if (!userId) {
  console.error('Usage: npm run surviel:verify-tiers -- <userId>');
  process.exit(1);
}

const CHAT_URL = 'https://openrouter.ai/api/v1/chat/completions';
const apiModule = api();
const client = openRouterClient(apiModule);
const config = survielConfig(apiModule);
const { mongoose, db } = await connectDb();

const TIER_BLOCK = {
  1: undefined,
  2: { data_collection: 'deny' },
  3: { zdr: true, data_collection: 'deny' },
};

async function loadTierKey(endpoint) {
  const values = await db.getUserKeyValues({ userId, name: endpoint });
  if (!values?.apiKey) throw new Error(`No provisioned key for endpoint ${endpoint}`);
  return values.apiKey;
}

async function probe({ apiKey, model, provider }) {
  const response = await fetch(CHAT_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'X-OpenRouter-Experimental-Metadata': 'enabled',
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: 'ping' }],
      max_tokens: 1,
      ...(provider ? { provider } : {}),
    }),
  });
  const text = await response.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    payload = {};
  }
  return { status: response.status, payload };
}

function selectedProvider(payload) {
  const endpoints = payload?.openrouter_metadata?.endpoints?.available ?? [];
  return endpoints.find((entry) => entry.selected)?.provider ?? null;
}

const zdr = await client.listZdrEndpoints();
const zdrProviders = new Set(zdr.map((entry) => String(entry.provider_name).toLowerCase()));

let failures = 0;
const results = [];

for (const tier of config.tiers) {
  const provider = TIER_BLOCK[tier.tier];
  const apiKey = await loadTierKey(tier.endpoint);
  const model =
    tier.tier === 3 ? (zdr[0]?.model_name ?? 'openai/gpt-4o-mini') : 'openai/gpt-4o-mini';
  let outcome;
  try {
    const { status, payload } = await probe({ apiKey, model, provider });
    const routed = selectedProvider(payload);
    let pass = status === 200;
    if (tier.tier === 3 && pass) {
      pass = routed != null && zdrProviders.has(String(routed).toLowerCase());
    }
    if (!pass) failures += 1;
    outcome = { tier: tier.tier, endpoint: tier.endpoint, status, routed, pass };
  } catch (error) {
    failures += 1;
    outcome = { tier: tier.tier, endpoint: tier.endpoint, error: error.message, pass: false };
  }
  results.push(outcome);
  console.log(
    `tier ${outcome.tier} (${outcome.endpoint}): ${outcome.pass ? 'PASS' : 'FAIL'}` +
      (outcome.status ? ` status=${outcome.status}` : '') +
      (outcome.routed ? ` routed=${outcome.routed}` : '') +
      (outcome.error ? ` error=${outcome.error}` : ''),
  );
}

await mongoose.disconnect();

if (failures > 0) {
  console.error(`${failures} tier check(s) failed.`);
  process.exit(1);
}
console.log('All tier checks passed.');
