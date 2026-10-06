import { createRequire } from 'node:module';
import path from 'node:path';
import dotenv from 'dotenv';
import { repoRoot } from './env.mjs';

dotenv.config({ path: path.join(repoRoot, '.env') });

export const require = createRequire(import.meta.url);

/** Load the built @librechat/api package (behavior lives there, not in the script). */
export function api() {
  return require('@librechat/api');
}

/** OpenRouter management client from env, or exit with a clear message. */
export function openRouterClient(apiModule = api()) {
  const client = apiModule.createOpenRouterClientFromEnv();
  if (!client) {
    console.error('OPENROUTER_MANAGEMENT_KEY is not set. Add it to .env and retry.');
    process.exit(1);
  }
  return client;
}

/** Resolved Surviel config using schema defaults (the fork ships matching tier names). */
export function survielConfig(apiModule = api()) {
  return apiModule.resolveSurvielConfig({ enabled: true });
}

/** Connect to MongoDB and return data-schemas methods. */
export async function connectDb() {
  const mongoose = require('mongoose');
  const { createMethods } = require('@librechat/data-schemas');
  const uri = process.env.MONGO_URI;
  if (!uri) {
    console.error('MONGO_URI is not set. Add it to .env and retry.');
    process.exit(1);
  }
  await mongoose.connect(uri);
  const db = createMethods(mongoose);
  return { mongoose, db };
}
