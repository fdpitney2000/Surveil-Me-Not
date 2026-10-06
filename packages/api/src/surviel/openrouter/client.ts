import { SurvielError, SurvielErrorCodes } from '../errors';

export const OPENROUTER_API_BASE = 'https://openrouter.ai/api/v1';

export interface OpenRouterApiKey {
  hash: string;
  name: string;
  label: string;
  disabled: boolean;
  limit: number | null;
  limit_remaining: number | null;
  limit_reset: 'daily' | 'weekly' | 'monthly' | null;
  include_byok_in_limit: boolean;
  usage: number;
  usage_daily: number;
  usage_weekly: number;
  usage_monthly: number;
  byok_usage: number;
  created_at: string;
  updated_at: string | null;
  expires_at?: string | null;
  workspace_id?: string | null;
}

export interface OpenRouterGuardrail {
  id: string;
  name: string;
  limit_usd: number | null;
  reset_interval: 'daily' | 'weekly' | 'monthly' | null;
  include_byok_in_budget?: boolean;
  allowed_models?: string[] | null;
  allowed_providers?: string[] | null;
  enforce_zdr_anthropic?: boolean | null;
  enforce_zdr_openai?: boolean | null;
  enforce_zdr_google?: boolean | null;
  enforce_zdr_xai?: boolean | null;
  enforce_zdr_other?: boolean | null;
}

export interface OpenRouterCreateKeyInput {
  name: string;
  limit?: number | null;
  limit_reset?: 'daily' | 'weekly' | 'monthly' | null;
  disabled?: boolean;
  expires_at?: string | null;
}

export interface OpenRouterCreateKeyResult {
  key: string;
  data: OpenRouterApiKey;
}

export interface OpenRouterModelPricing {
  id: string;
  canonical_slug: string;
  name: string;
  context_length: number | null;
  pricing: Record<string, string>;
  supported_parameters?: string[];
}

export interface OpenRouterZdrEndpoint {
  name: string;
  model_name: string;
  provider_name: string;
  supports_implicit_caching?: boolean;
}

export interface OpenRouterClient {
  listGuardrails(): Promise<OpenRouterGuardrail[]>;
  createGuardrail(body: Record<string, unknown>): Promise<OpenRouterGuardrail>;
  updateGuardrail(id: string, body: Record<string, unknown>): Promise<OpenRouterGuardrail>;
  assignKeysToGuardrail(id: string, keyHashes: string[]): Promise<number>;
  listKeys(offset?: number): Promise<OpenRouterApiKey[]>;
  listAllKeys(): Promise<OpenRouterApiKey[]>;
  getKey(hash: string): Promise<OpenRouterApiKey>;
  createKey(input: OpenRouterCreateKeyInput): Promise<OpenRouterCreateKeyResult>;
  updateKey(hash: string, body: Record<string, unknown>): Promise<OpenRouterApiKey>;
  deleteKey(hash: string): Promise<void>;
  getOrganizationSettings(): Promise<Record<string, unknown>>;
  updateOrganizationSettings(body: Record<string, unknown>): Promise<Record<string, unknown>>;
  getCredits(): Promise<{ total_credits: number; total_usage: number }>;
  listModels(): Promise<OpenRouterModelPricing[]>;
  listUserModels(): Promise<OpenRouterModelPricing[]>;
  listZdrEndpoints(): Promise<OpenRouterZdrEndpoint[]>;
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const PAGE_SIZE = 100;

export interface CreateOpenRouterClientOptions {
  managementKey: string;
  baseUrl?: string;
  fetchImpl?: FetchLike;
}

/**
 * Minimal client for the OpenRouter Management API. It never logs request or response
 * bodies: create-key responses contain the plaintext key, which the caller routes straight
 * to the encrypted store.
 */
export function createOpenRouterClient(options: CreateOpenRouterClientOptions): OpenRouterClient {
  const { managementKey, baseUrl = OPENROUTER_API_BASE } = options;
  const fetchImpl: FetchLike = options.fetchImpl ?? ((input, init) => fetch(input, init));

  async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
    if (!managementKey) {
      throw new SurvielError(
        SurvielErrorCodes.NOT_CONFIGURED,
        'OpenRouter management key is not configured.',
        503,
      );
    }
    let response: Response;
    try {
      response = await fetchImpl(`${baseUrl}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${managementKey}`,
          'Content-Type': 'application/json',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (error) {
      throw new SurvielError(
        SurvielErrorCodes.OPENROUTER_ERROR,
        `OpenRouter request failed: ${error instanceof Error ? error.message : 'network error'}`,
        502,
      );
    }

    if (response.status === 204) {
      return undefined as T;
    }

    let payload: unknown = undefined;
    const text = await response.text();
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = undefined;
      }
    }

    if (!response.ok) {
      const upstreamMessage =
        payload &&
        typeof payload === 'object' &&
        'error' in payload &&
        payload.error &&
        typeof payload.error === 'object' &&
        'message' in payload.error &&
        typeof (payload.error as { message?: unknown }).message === 'string'
          ? (payload.error as { message: string }).message
          : `HTTP ${response.status}`;
      throw new SurvielError(
        SurvielErrorCodes.OPENROUTER_ERROR,
        `OpenRouter ${method} ${path} failed (${response.status}): ${upstreamMessage}`,
        response.status >= 500 ? 502 : response.status,
      );
    }

    return payload as T;
  }

  async function listKeys(offset = 0): Promise<OpenRouterApiKey[]> {
    const result = await request<{ data: OpenRouterApiKey[] }>(
      'GET',
      `/keys?offset=${encodeURIComponent(String(offset))}`,
    );
    return result.data ?? [];
  }

  return {
    async listGuardrails() {
      const result = await request<{ data: OpenRouterGuardrail[] }>('GET', '/guardrails');
      return result.data ?? [];
    },
    async createGuardrail(body) {
      const result = await request<{ data: OpenRouterGuardrail }>('POST', '/guardrails', body);
      return result.data;
    },
    async updateGuardrail(id, body) {
      const result = await request<{ data: OpenRouterGuardrail }>(
        'PATCH',
        `/guardrails/${encodeURIComponent(id)}`,
        body,
      );
      return result.data;
    },
    async assignKeysToGuardrail(id, keyHashes) {
      const result = await request<{ assigned_count: number }>(
        'POST',
        `/guardrails/${encodeURIComponent(id)}/assignments/keys`,
        { key_hashes: keyHashes },
      );
      return result.assigned_count;
    },
    listKeys,
    async listAllKeys() {
      const all: OpenRouterApiKey[] = [];
      let offset = 0;
      for (;;) {
        const page = await listKeys(offset);
        all.push(...page);
        if (page.length < PAGE_SIZE) return all;
        offset += PAGE_SIZE;
      }
    },
    async getKey(hash) {
      const result = await request<{ data: OpenRouterApiKey }>(
        'GET',
        `/keys/${encodeURIComponent(hash)}`,
      );
      return result.data;
    },
    async createKey(input) {
      const result = await request<OpenRouterCreateKeyResult>('POST', '/keys', input);
      return result;
    },
    async updateKey(hash, body) {
      const result = await request<{ data: OpenRouterApiKey }>(
        'PATCH',
        `/keys/${encodeURIComponent(hash)}`,
        body,
      );
      return result.data;
    },
    async deleteKey(hash) {
      await request<undefined>('DELETE', `/keys/${encodeURIComponent(hash)}`);
    },
    async getOrganizationSettings() {
      const result = await request<{ data: Record<string, unknown> }>(
        'GET',
        '/organization/settings',
      );
      return result.data ?? {};
    },
    async updateOrganizationSettings(body) {
      const result = await request<{ data: Record<string, unknown> }>(
        'PATCH',
        '/organization/settings',
        body,
      );
      return result.data ?? {};
    },
    async getCredits() {
      const result = await request<{ data: { total_credits: number; total_usage: number } }>(
        'GET',
        '/credits',
      );
      return result.data;
    },
    async listModels() {
      const result = await request<{ data: OpenRouterModelPricing[] }>('GET', '/models');
      return result.data ?? [];
    },
    async listUserModels() {
      const result = await request<{ data: OpenRouterModelPricing[] }>('GET', '/models/user');
      return result.data ?? [];
    },
    async listZdrEndpoints() {
      const result = await request<{ data: OpenRouterZdrEndpoint[] }>('GET', '/endpoints/zdr');
      return result.data ?? [];
    },
  };
}

/** Build a client from `OPENROUTER_MANAGEMENT_KEY`, or undefined when it is unset. */
export function createOpenRouterClientFromEnv(fetchImpl?: FetchLike): OpenRouterClient | undefined {
  const managementKey = process.env.OPENROUTER_MANAGEMENT_KEY;
  if (!managementKey) return undefined;
  return createOpenRouterClient({ managementKey, fetchImpl });
}
