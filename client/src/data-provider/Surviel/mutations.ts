import { QueryKeys, dataService } from 'librechat-data-provider';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type {
  TSurvielCredits,
  TSurvielPricingResponse,
  TSurvielCheckoutRequest,
  TSurvielCheckoutResponse,
  TSurvielPortalResponse,
} from 'librechat-data-provider';
import type { UseMutationResult } from '@tanstack/react-query';

/** Force an on-demand reconcile and refresh the credits widget. */
export const useRefreshSurvielCredits = (): UseMutationResult<TSurvielCredits, unknown, void> => {
  const queryClient = useQueryClient();
  return useMutation(() => dataService.refreshSurvielCredits(), {
    onSuccess: (data) => {
      queryClient.setQueryData([QueryKeys.survielCredits], data);
    },
  });
};

export const useRefreshSurvielPricing = (): UseMutationResult<
  TSurvielPricingResponse,
  unknown,
  void
> => {
  const queryClient = useQueryClient();
  return useMutation(() => dataService.refreshSurvielPricing(), {
    onSuccess: (data) => {
      queryClient.setQueryData([QueryKeys.survielPricing], data);
    },
  });
};

/** Start a Stripe Checkout Session and return its redirect URL. */
export const useCreateSurvielCheckout = (): UseMutationResult<
  TSurvielCheckoutResponse,
  unknown,
  TSurvielCheckoutRequest
> => {
  return useMutation((payload) => dataService.createSurvielCheckout(payload));
};

/** Open the Stripe Billing Portal for subscription management. */
export const useCreateSurvielPortal = (): UseMutationResult<
  TSurvielPortalResponse,
  unknown,
  void
> => {
  return useMutation(() => dataService.createSurvielPortal());
};
