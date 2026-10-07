import { useQuery } from '@tanstack/react-query';
import { QueryKeys, dataService } from 'librechat-data-provider';
import type { TSurvielCredits, TSurvielPricingResponse } from 'librechat-data-provider';
import type { QueryObserverResult, UseQueryOptions } from '@tanstack/react-query';

/** The user's current plan, status, and remaining credits. Polled while mounted. */
export const useSurvielCredits = (
  config?: UseQueryOptions<TSurvielCredits>,
): QueryObserverResult<TSurvielCredits> => {
  return useQuery<TSurvielCredits>(
    [QueryKeys.survielCredits],
    () => dataService.getSurvielCredits(),
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
export const useSurvielPricing = (
  config?: UseQueryOptions<TSurvielPricingResponse>,
): QueryObserverResult<TSurvielPricingResponse> => {
  return useQuery<TSurvielPricingResponse>(
    [QueryKeys.survielPricing],
    () => dataService.getSurvielPricing(),
    {
      staleTime: 3_600_000,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      ...config,
    },
  );
};
