import React, { createContext, useContext, useMemo } from 'react';
import { isSurveilFreeModel, sortSurveilModelsFreeFirst } from 'librechat-data-provider';
import { useGetStartupConfig, useSurveilCredits, useSurveilPricing } from '~/data-provider';

export interface SurveilModelAccess {
  /** Whether the endpoint (by value, i.e. its configured name) is a Surveil privacy tier. */
  isSurveilEndpoint: (endpointValue: string) => boolean;
  /** Whether the user has any subscription record (free users have none). */
  hasActiveSubscription: boolean;
  isFreeModel: (modelId: string) => boolean;
  /** Locked rows stay visible but cannot be selected: tier + paid model + no subscription. */
  isLocked: (endpointValue: string, modelId: string) => boolean;
  /** Free-first ordering for a tier's picker; identity for non-tier endpoints. */
  sortForEndpoint: (endpointValue: string, modelIds: string[]) => string[];
}

/** Rows rendered outside the provider (tests, other surfaces) behave as before. */
const defaultAccess: SurveilModelAccess = {
  isSurveilEndpoint: () => false,
  hasActiveSubscription: false,
  isFreeModel: () => false,
  isLocked: () => false,
  sortForEndpoint: (_endpoint, modelIds) => modelIds,
};

const SurveilModelAccessContext = createContext<SurveilModelAccess>(defaultAccess);

/**
 * One subscription set (startup config, credits, pricing) for every model row in the
 * selector; rows read the context instead of opening per-row React Query subscriptions.
 */
export function SurveilModelAccessProvider({ children }: { children: React.ReactNode }) {
  const { data: startupConfig } = useGetStartupConfig();
  const surveil = startupConfig?.surveil;
  const enabled = surveil?.enabled === true;
  const { data: credits } = useSurveilCredits({ enabled });
  const { data: pricing } = useSurveilPricing({ enabled });

  const value = useMemo<SurveilModelAccess>(() => {
    if (!enabled) {
      return defaultAccess;
    }
    const tierEndpoints = new Set((surveil?.tiers ?? []).map((tier) => tier.endpoint));
    const models = pricing?.models;
    const hasActiveSubscription = credits != null && credits.status !== 'none';
    const isSurveilEndpoint = (endpointValue: string) => tierEndpoints.has(endpointValue);
    const isFreeModel = (modelId: string) => isSurveilFreeModel(modelId, models);
    return {
      isSurveilEndpoint,
      hasActiveSubscription,
      isFreeModel,
      isLocked: (endpointValue, modelId) =>
        isSurveilEndpoint(endpointValue) && !hasActiveSubscription && !isFreeModel(modelId),
      sortForEndpoint: (endpointValue, modelIds) =>
        isSurveilEndpoint(endpointValue) ? sortSurveilModelsFreeFirst(modelIds, models) : modelIds,
    };
  }, [enabled, surveil?.tiers, pricing?.models, credits]);

  return (
    <SurveilModelAccessContext.Provider value={value}>
      {children}
    </SurveilModelAccessContext.Provider>
  );
}

export function useSurveilModelAccess(): SurveilModelAccess {
  return useContext(SurveilModelAccessContext);
}
