import { QueryKeys, dataService } from 'librechat-data-provider';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type {
  TSurveilCredits,
  TSurveilPricingResponse,
  TSurveilCheckoutRequest,
  TSurveilCheckoutResponse,
  TSurveilPortalResponse,
} from 'librechat-data-provider';
import type { UseMutationResult } from '@tanstack/react-query';

/** Force an on-demand reconcile and refresh the credits widget. */
export const useRefreshSurveilCredits = (): UseMutationResult<TSurveilCredits, unknown, void> => {
  const queryClient = useQueryClient();
  return useMutation(() => dataService.refreshSurveilCredits(), {
    onSuccess: (data) => {
      queryClient.setQueryData([QueryKeys.surveilCredits], data);
    },
  });
};

export const useRefreshSurveilPricing = (): UseMutationResult<
  TSurveilPricingResponse,
  unknown,
  void
> => {
  const queryClient = useQueryClient();
  return useMutation(() => dataService.refreshSurveilPricing(), {
    onSuccess: (data) => {
      queryClient.setQueryData([QueryKeys.surveilPricing], data);
    },
  });
};

/** Start a Stripe Checkout Session and return its redirect URL. */
export const useCreateSurveilCheckout = (): UseMutationResult<
  TSurveilCheckoutResponse,
  unknown,
  TSurveilCheckoutRequest
> => {
  return useMutation((payload) => dataService.createSurveilCheckout(payload));
};

/** Open the Stripe Billing Portal for subscription management. */
export const useCreateSurveilPortal = (): UseMutationResult<
  TSurveilPortalResponse,
  unknown,
  void
> => {
  return useMutation(() => dataService.createSurveilPortal());
};
