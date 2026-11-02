import { useQuery } from '@tanstack/react-query';
import { QueryKeys, dataService } from 'librechat-data-provider';
import type { TSurveilCredits, TSurveilPricingResponse } from 'librechat-data-provider';
import type { QueryObserverResult, UseQueryOptions } from '@tanstack/react-query';

/** The user's current plan, status, and remaining credits. Polled while mounted. */
export const useSurveilCredits = (
  config?: UseQueryOptions<TSurveilCredits>,
): QueryObserverResult<TSurveilCredits> => {
  return useQuery<TSurveilCredits>(
    [QueryKeys.surveilCredits],
    () => dataService.getSurveilCredits(),
    {
      refetchInterval: 60_000,
      staleTime: 15_000,
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
      ...config,
    },
  );
};

/** Model pricing for display in the picker (cached server-side with SWR). */
export const useSurveilPricing = (
  config?: UseQueryOptions<TSurveilPricingResponse>,
): QueryObserverResult<TSurveilPricingResponse> => {
  return useQuery<TSurveilPricingResponse>(
    [QueryKeys.surveilPricing],
    () => dataService.getSurveilPricing(),
    {
      staleTime: 3_600_000,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      ...config,
    },
  );
};
