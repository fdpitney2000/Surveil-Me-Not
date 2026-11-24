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
import {
  getPreferredFreeModel,
  isSurveilTierEndpoint,
  applySurveilReasoningDefault,
} from '~/utils/surveilModelDefaults';
import { useGetEndpointsQuery, useGetStartupConfig, useSurveilCredits } from '~/data-provider';
import { getDefaultEndpoint, buildDefaultConvo } from '~/utils';

type TDefaultConvo = {
  conversation: Partial<TConversation>;
  preset?: Partial<TPreset> | null;
  cleanInput?: boolean;
  cleanOutput?: boolean;
};

const exceptions = new Set(['spec', 'iconURL']);

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
      const isSurveilTier = isSurveilTierEndpoint(endpoint, startupConfig?.surveil?.tiers);
      const hasNoSubscription = surveilCredits == null || surveilCredits.status === 'none';
      const preferredModel =
        isSurveilTier && hasNoSubscription ? getPreferredFreeModel(models) : undefined;
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

      /** The pinned DeepSeek model thinks by default; new Surveil chats open without thinking. */
      applySurveilReasoningDefault(defaultConvo);

      /** Web search is on for new conversations unless the preset/previous state
       *  explicitly turned it off. The Parameters side panel reflects this value. */
      if (startupConfig?.interface?.webSearch === true && defaultConvo.web_search == null) {
        defaultConvo.web_search = true;
      }

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
    [
      endpointsConfig,
      modelsConfig,
      startupConfig?.surveil,
      startupConfig?.interface?.webSearch,
      surveilCredits,
    ],
  );

  return getDefaultConversation;
};

export default useDefaultConvo;
