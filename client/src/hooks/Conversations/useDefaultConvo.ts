import { useCallback } from 'react';
import { useGetModelsQuery } from 'librechat-data-provider/react-query';
import {
  excludedKeys,
  getDefaultParamsEndpoint,
  resolveModelCatalogKey,
} from 'librechat-data-provider';
import type {
  TEndpointsConfig,
  TModelsConfig,
  TConversation,
  TPreset,
} from 'librechat-data-provider';
import { getDefaultEndpoint, buildDefaultConvo } from '~/utils';
import { useGetEndpointsQuery, useGetStartupConfig, useSurveilCredits } from '~/data-provider';

type TDefaultConvo = {
  conversation: Partial<TConversation>;
  preset?: Partial<TPreset> | null;
  cleanInput?: boolean;
  cleanOutput?: boolean;
};

const exceptions = new Set(['spec', 'iconURL']);
const PREFERRED_FREE_MODEL = 'google/gemma-4-31b-it:free';

const useDefaultConvo = () => {
  const { data: endpointsConfig = {} as TEndpointsConfig } = useGetEndpointsQuery();
  const { data: modelsConfig = {} as TModelsConfig } = useGetModelsQuery();
  const { data: startupConfig } = useGetStartupConfig();
  const surveilEnabled = startupConfig?.surveil?.enabled === true;
  const { data: surveilCredits } = useSurveilCredits({ enabled: surveilEnabled });

  const getDefaultConversation = useCallback(
    ({ conversation: _convo, preset, cleanInput, cleanOutput }: TDefaultConvo) => {
      const endpoint = getDefaultEndpoint({
        convoSetup: preset as TPreset,
        endpointsConfig,
      });

      const models = modelsConfig[resolveModelCatalogKey(endpoint, modelsConfig)] || [];
      const isSurveilTier = startupConfig?.surveil?.tiers.some(
        (tier) => tier.endpoint === endpoint,
      );
      const hasNoSubscription = surveilCredits == null || surveilCredits.status === 'none';
      const preferredModel =
        isSurveilTier && hasNoSubscription
          ? models.find((model) => model === PREFERRED_FREE_MODEL) ??
            models.find((model) => model.endsWith(':free')) ??
            models[0]
          : undefined;
      const conversation = { ..._convo };
      if (cleanInput === true) {
        for (const key in conversation) {
          if (excludedKeys.has(key) && !exceptions.has(key)) {
            continue;
          }
          if (conversation[key] == null) {
            continue;
          }
          conversation[key] = undefined;
        }
      }

      const defaultParamsEndpoint = getDefaultParamsEndpoint(endpointsConfig, endpoint);

      const defaultConvo = buildDefaultConvo({
        conversation: conversation as TConversation,
        endpoint,
        lastConversationSetup: preset as TConversation,
        models,
        defaultParamsEndpoint,
        preferredModel,
      });

      if (!cleanOutput) {
        return defaultConvo;
      }

      for (const key in defaultConvo) {
        if (excludedKeys.has(key) && !exceptions.has(key)) {
          continue;
        }
        if (defaultConvo[key] == null) {
          continue;
        }
        defaultConvo[key] = undefined;
      }

      return defaultConvo;
    },
    [endpointsConfig, modelsConfig, startupConfig?.surveil, surveilCredits],
  );

  return getDefaultConversation;
};

export default useDefaultConvo;
