import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

/** Absolute path to the repository root (scripts/surviel/lib -> root). */
export const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
);

export const envPath = path.join(repoRoot, '.env');

/**
 * Parse a dotenv-style file into a map. Values are never logged.
 * @param {string} [file]
 * @returns {Map<string, string>}
 */
export function loadEnvFile(file = envPath) {
  const map = new Map();
  let contents;
  try {
    contents = readFileSync(file, 'utf8');
  } catch {
    return map;
  }
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    map.set(key, value);
  }
  return map;
}

/**
 * Report whether a variable is set without revealing its value.
 * @param {Map<string, string>} env
 * @param {string} key
 * @returns {'SET' | 'EMPTY' | 'MISSING'}
 */
export function envStatus(env, key) {
  if (!env.has(key)) return 'MISSING';
  return env.get(key).length > 0 ? 'SET' : 'EMPTY';
}

/**
 * Insert or replace `KEY=value` in the dotenv file, preserving all other lines.
 * The value is never echoed to stdout.
 * @param {string} key
 * @param {string} value
 * @param {string} [file]
 */
export function upsertEnvVar(key, value, file = envPath) {
  let contents = '';
  try {
    contents = readFileSync(file, 'utf8');
  } catch {
    contents = '';
  }
  const line = `${key}=${value}`;
  const lines = contents.split(/\r?\n/);
  let replaced = false;
  const next = lines.map((raw) => {
    if (/^\s*#/.test(raw)) return raw;
    const eq = raw.indexOf('=');
    if (eq !== -1 && raw.slice(0, eq).trim() === key) {
      replaced = true;
      return line;
    }
    return raw;
  });
  if (!replaced) {
    if (next.length > 0 && next[next.length - 1] !== '') next.push('');
    next.push(line);
  }
  writeFileSync(file, next.join('\n'));
}
