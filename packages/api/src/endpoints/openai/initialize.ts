import { ErrorTypes, EModelEndpoint, mapModelToAzureConfig } from 'librechat-data-provider';
import type { TSurveilConfig } from 'librechat-data-provider';
import type {
  InitializeResultBase,
  OpenAIConfigOptions,
  ProviderInitializeParams,
  UserKeyValues,
} from '~/types';
import {
  mergeHeaders,
  resolveHeaders,
  isUserProvided,
  checkUserKeyExpiry,
  getAzureCredentials,
} from '~/utils';
import { resolveModelTransportTimeouts } from '~/agents/config';
import { isSurveilTierEndpoint } from '~/surveil/config';
import { getOpenAIEndpointParameters } from './parameters';
import { resolveEndpointRuntime } from '~/types';
import { validateEndpointURL } from '~/auth';
import { getOpenAIConfig } from './config';

/**
 * Admin-configured base URL for a built-in OpenAI-family endpoint, or `undefined`
 * when the endpoint is served by OpenAI/Azure directly.
 *
 * Read at call time rather than module load so environment changes apply, and
 * shared with callers that must know the endpoint a built-in provider actually
 * talks to before claiming its contract. May be the `user_provided` sentinel,
 * which resolves to a per-user value only after a database read.
 */
export function getBuiltInBaseURL(endpoint?: string | null): string | undefined {
  if (endpoint === EModelEndpoint.openAI) {
    return process.env.OPENAI_REVERSE_PROXY;
  }
  if (endpoint === EModelEndpoint.azureOpenAI) {
    return process.env.AZURE_OPENAI_BASEURL;
  }
  return undefined;
}

/**
 * Initializes OpenAI options for agent usage. This function always returns configuration
 * options and never creates a client instance (equivalent to optionsOnly=true behavior).
 *
 * @param params - Configuration parameters
 * @returns Promise resolving to OpenAI configuration options
 * @throws Error if API key is missing or user key has expired
 */
export async function initializeOpenAI(
  params: ProviderInitializeParams,
): Promise<InitializeResultBase> {
  const { endpoint, model_parameters, db } = params;
  const { appConfig, user, requestBody } = resolveEndpointRuntime(params);
  const openAIConfig = appConfig?.endpoints?.[EModelEndpoint.openAI];
  const allConfig = appConfig?.endpoints?.all;
  const { PROXY, OPENAI_API_KEY, AZURE_API_KEY } = process.env;

  const { key: expiresAt } = requestBody;
  const modelName = model_parameters?.model as string | undefined;

  const credentials = {
    [EModelEndpoint.openAI]: OPENAI_API_KEY,
    [EModelEndpoint.azureOpenAI]: AZURE_API_KEY,
  };

  const configuredBaseURL = getBuiltInBaseURL(endpoint);

  const userProvidesKey = isUserProvided(credentials[endpoint as keyof typeof credentials]);
  const userProvidesURL = isUserProvided(configuredBaseURL);
  const isAzureOpenAI = endpoint === EModelEndpoint.azureOpenAI;
  const azureConfig = isAzureOpenAI && appConfig?.endpoints?.[EModelEndpoint.azureOpenAI];
  const mappedAzureConfig = azureConfig
    ? mapModelToAzureConfig({
        modelName: modelName || '',
        modelGroupMap: azureConfig.modelGroupMap,
        groupMap: azureConfig.groupMap,
      })
    : null;
  const needsUserKey = userProvidesKey && !mappedAzureConfig;
  const needsUserURL = userProvidesURL && !mappedAzureConfig?.baseURL;

  let userValues: UserKeyValues | null = null;
  if (expiresAt && (needsUserKey || needsUserURL)) {
    checkUserKeyExpiry(expiresAt, endpoint);
  }
  if (needsUserKey || needsUserURL) {
    try {
      userValues = await db.getUserKeyValues({ userId: user?.id ?? '', name: endpoint });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (
        !message.includes(ErrorTypes.NO_USER_KEY) &&
        !message.includes(ErrorTypes.INVALID_USER_KEY)
      ) {
        throw error;
      }
      /** No stored key is the normal free-tier state; the shared fallback below handles it. */
      userValues = null;
    }
  }

  let apiKey = userProvidesKey
    ? userValues?.apiKey
    : credentials[endpoint as keyof typeof credentials];
  /**
   * Surveil tier endpoints use a user-provided key slot. A signed-up user without a
   * subscription has no managed key, so use the shared free-model key. The key is
   * guardrail-restricted to free models and never leaves the server.
   *
   * The Agents controller resolves the provider as `openai`/`custom` and keeps the
   * public tier name on the request body, so check both places.
   */
  const tierEndpoint = [endpoint, requestBody?.endpoint].find(
    (candidate): candidate is string =>
      typeof candidate === 'string' &&
      isSurveilTierEndpoint(appConfig?.surveil as Partial<TSurveilConfig> | undefined, candidate),
  );
  if (!apiKey && tierEndpoint) {
    apiKey = process.env.SURVEIL_FREE_OPENROUTER_KEY?.trim();
  }
  const baseURL = userProvidesURL ? userValues?.baseURL : configuredBaseURL;

  const clientOptions: OpenAIConfigOptions = {
    proxy: PROXY ?? undefined,
    reverseProxyUrl: baseURL || undefined,
    baseURLIsUserProvided: userProvidesURL,
    allowedAddresses: appConfig?.endpoints?.allowedAddresses,
    transportTimeouts: resolveModelTransportTimeouts(appConfig?.endpoints?.agents),
    streaming: true,
    ...getOpenAIEndpointParameters(appConfig, endpoint, modelName),
  };

  /**
   * Custom headers are forwarded only when the destination URL is admin-trusted.
   * When the user supplies the base URL, withhold them — they may carry
   * `${SECRET}` gateway values or user/OpenID token placeholders resolved later
   * by `resolveConfigHeaders`, which must not reach a user-controlled endpoint.
   */
  const trustedURL = !userProvidesURL;
  const globalHeaders = trustedURL ? allConfig?.headers : undefined;
  const openAIHeaders = trustedURL
    ? mergeHeaders(allConfig?.headers, openAIConfig?.headers)
    : undefined;

  let isServerless = false;

  if (isAzureOpenAI && azureConfig && mappedAzureConfig) {
    const { azureOptions, baseURL: configBaseURL, headers = {}, serverless } = mappedAzureConfig;
    isServerless = serverless === true;

    clientOptions.reverseProxyUrl = configBaseURL ?? clientOptions.reverseProxyUrl;
    if (configBaseURL) {
      clientOptions.baseURLIsUserProvided = false;
    }
    clientOptions.headers = resolveHeaders({
      headers: { ...headers, ...(clientOptions.headers ?? {}) },
      user,
    });
    /** `endpoints.all` headers apply globally, but stay unresolved here — they are
     *  resolved once at request time by `resolveConfigHeaders`. Resolving them now
     *  (in addition) would re-expand already-substituted user values, violating the
     *  env-before-user invariant. Azure-managed headers stay authoritative. */
    if (globalHeaders) {
      clientOptions.headers = mergeHeaders(globalHeaders, clientOptions.headers);
    }

    apiKey = azureOptions.azureOpenAIApiKey;
    clientOptions.azure = !isServerless ? azureOptions : undefined;

    if (isServerless) {
      clientOptions.defaultQuery = azureOptions.azureOpenAIApiVersion
        ? { 'api-version': azureOptions.azureOpenAIApiVersion }
        : undefined;

      if (!clientOptions.headers) {
        clientOptions.headers = {};
      }
      clientOptions.headers['api-key'] = apiKey;
    }
  } else if (isAzureOpenAI) {
    clientOptions.azure =
      userProvidesKey && userValues?.apiKey ? JSON.parse(userValues.apiKey) : getAzureCredentials();
    apiKey = clientOptions.azure ? clientOptions.azure.azureOpenAIApiKey : undefined;
    /** Env-var Azure path has no per-model headers; still honor global `all` headers. */
    if (globalHeaders) {
      clientOptions.headers = { ...globalHeaders };
    }
  } else {
    /**
     * Attach admin-configured custom headers for the built-in OpenAI endpoint
     * (endpoint over global `all`). Kept unresolved here so request-body
     * placeholders resolve at request time via `resolveConfigHeaders`.
     */
    if (openAIHeaders) {
      clientOptions.headers = openAIHeaders;
    }
  }

  if (clientOptions.baseURLIsUserProvided && clientOptions.reverseProxyUrl) {
    await validateEndpointURL(
      clientOptions.reverseProxyUrl,
      endpoint,
      appConfig?.endpoints?.allowedAddresses,
    );
  }

  if (userProvidesKey && !apiKey) {
    throw new Error(
      JSON.stringify({
        type: ErrorTypes.NO_USER_KEY,
      }),
    );
  }

  if (!apiKey) {
    throw new Error(`${endpoint} API Key not provided.`);
  }

  const modelOptions = {
    ...(model_parameters ?? {}),
    model: modelName,
    user: user?.id,
  };

  const finalClientOptions: OpenAIConfigOptions = {
    ...clientOptions,
    modelOptions,
  };

  const options: InitializeResultBase = getOpenAIConfig(apiKey, finalClientOptions, endpoint);
  if (clientOptions.azure) {
    options.azureOptions = { ...clientOptions.azure };
  }

  /** Set useLegacyContent for Azure serverless deployments */
  if (isServerless) {
    (options as InitializeResultBase).useLegacyContent = true;
  }

  let streamRate: number | undefined;

  if (isAzureOpenAI && azureConfig) {
    streamRate = azureConfig.streamRate;
  } else if (!isAzureOpenAI && openAIConfig) {
    streamRate = openAIConfig.streamRate;
  }

  if (allConfig?.streamRate != null) {
    streamRate = allConfig.streamRate;
  }

  if (streamRate != null) {
    options.llmConfig._lc_stream_delay = streamRate;
  }

  return options;
}
