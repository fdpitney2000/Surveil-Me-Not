#!/usr/bin/env node
/**
 * Warm the model-pricing cache from the OpenRouter models endpoint and report the count.
 * Output is redacted: only model counts and the fetch time are printed.
 */
import { openRouterClient, api } from './lib/runtime.mjs';

const apiModule = api();
const client = openRouterClient(apiModule);

const models = await client.listModels();
console.log(`Fetched pricing for ${models.length} model(s) at ${new Date().toISOString()}.`);
