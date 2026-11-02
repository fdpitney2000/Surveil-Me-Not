import React, { createContext, useContext, useMemo } from 'react';
import { isSurvielFreeModel, sortSurvielModelsFreeFirst } from 'librechat-data-provider';
import { useGetStartupConfig, useSurvielCredits, useSurvielPricing } from '~/data-provider';

export interface SurvielModelAccess {
  /** Whether the endpoint (by value, i.e. its configured name) is a Surviel privacy tier. */
  isSurvielEndpoint: (endpointValue: string) => boolean;
  /** Whether the user has any subscription record (free users have none). */
  hasActiveSubscription: boolean;
  isFreeModel: (modelId: string) => boolean;
  /** Locked rows stay visible but cannot be selected: tier + paid model + no subscription. */
  isLocked: (endpointValue: string, modelId: string) => boolean;
  /** Free-first ordering for a tier's picker; identity for non-tier endpoints. */
  sortForEndpoint: (endpointValue: string, modelIds: string[]) => string[];
}

/** Rows rendered outside the provider (tests, other surfaces) behave as before. */
const defaultAccess: SurvielModelAccess = {
  isSurvielEndpoint: () => false,
  hasActiveSubscription: false,
  isFreeModel: () => false,
  isLocked: () => false,
  sortForEndpoint: (_endpoint, modelIds) => modelIds,
};

const SurvielModelAccessContext = createContext<SurvielModelAccess>(defaultAccess);

/**
 * One subscription set (startup config, credits, pricing) for every model row in the
 * selector; rows read the context instead of opening per-row React Query subscriptions.
 */
export function SurvielModelAccessProvider({ children }: { children: React.ReactNode }) {
  const { data: startupConfig } = useGetStartupConfig();
  const surviel = startupConfig?.surviel;
  const enabled = surviel?.enabled === true;
  const { data: credits } = useSurvielCredits({ enabled });
  const { data: pricing } = useSurvielPricing({ enabled });

  const value = useMemo<SurvielModelAccess>(() => {
    if (!enabled) {
      return defaultAccess;
    }
    const tierEndpoints = new Set((surviel?.tiers ?? []).map((tier) => tier.endpoint));
    const models = pricing?.models;
    const hasActiveSubscription = credits != null && credits.status !== 'none';
    const isSurvielEndpoint = (endpointValue: string) => tierEndpoints.has(endpointValue);
    const isFreeModel = (modelId: string) => isSurvielFreeModel(modelId, models);
    return {
      isSurvielEndpoint,
      hasActiveSubscription,
      isFreeModel,
      isLocked: (endpointValue, modelId) =>
        isSurvielEndpoint(endpointValue) && !hasActiveSubscription && !isFreeModel(modelId),
      sortForEndpoint: (endpointValue, modelIds) =>
        isSurvielEndpoint(endpointValue) ? sortSurvielModelsFreeFirst(modelIds, models) : modelIds,
    };
  }, [enabled, surviel?.tiers, pricing?.models, credits]);

  return (
    <SurvielModelAccessContext.Provider value={value}>
      {children}
    </SurvielModelAccessContext.Provider>
  );
}

export function useSurvielModelAccess(): SurvielModelAccess {
  return useContext(SurvielModelAccessContext);
}
