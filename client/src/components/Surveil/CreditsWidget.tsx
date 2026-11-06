import { useMemo } from 'react';
import { Button } from '@librechat/client';
import type { TSurveilCredits, TSurveilPlanKey } from 'librechat-data-provider';
import {
  useGetStartupConfig,
  useSurveilCredits,
  useCreateSurveilCheckout,
  useCreateSurveilPortal,
  useRefreshSurveilCredits,
} from '~/data-provider';
import { useLocalize } from '~/hooks';

const PLANS: TSurveilPlanKey[] = ['50', '100', '200'];

function formatUsd(value: number): string {
  return `$${value.toFixed(2)}`;
}

function formatDate(value: string | null): string {
  if (!value) return '';
  try {
    return new Date(value).toLocaleDateString();
  } catch {
    return '';
  }
}

function useRedirect() {
  return (url: string | null | undefined) => {
    if (url) window.location.href = url;
  };
}

function PlanPicker() {
  const localize = useLocalize();
  const redirect = useRedirect();
  const checkout = useCreateSurveilCheckout();
  return (
    <div className="flex flex-col gap-1">
      <span className="text-text-secondary text-xs">{localize('com_surveil_pick_plan')}</span>
      <div className="flex gap-1">
        {PLANS.map((plan) => (
          <Button
            key={plan}
            size="sm"
            variant="outline"
            disabled={checkout.isLoading}
            onClick={() =>
              checkout.mutate(
                { plan },
                {
                  onSuccess: (data) => redirect(data.url),
                },
              )
            }
          >
            {formatUsd(Number(plan))}
          </Button>
        ))}
      </div>
    </div>
  );
}

/** Persistent remaining-credits widget for the sidebar. */
export default function CreditsWidget() {
  const localize = useLocalize();
  const { data: startupConfig } = useGetStartupConfig();
  const enabled = startupConfig?.surveil?.enabled === true;
  const { data: credits } = useSurveilCredits({ enabled });
  const refresh = useRefreshSurveilCredits();
  const portal = useCreateSurveilPortal();
  const redirect = useRedirect();

  const percentUsed = useMemo(() => {
    if (!credits || credits.grantUSD <= 0) return 0;
    return Math.min(100, Math.max(0, (credits.spentUSD / credits.grantUSD) * 100));
  }, [credits]);

  if (!enabled || !credits) return null;

  const hasSubscription = credits.status !== 'none';
  const renews = formatDate(credits.renewsAt);

  return (
    <div
      data-testid="surveil-credits-widget"
      className="border-border-inset bg-surface-primary mx-1 mb-2 rounded-lg border p-2"
    >
      {!hasSubscription ? (
        <div className="flex flex-col gap-2">
          <span className="text-text-primary text-sm font-medium">
            {localize('com_surveil_no_subscription')}
          </span>
          <PlanPicker />
        </div>
      ) : (
        <div className="flex flex-col gap-1">
          <div className="flex w-full items-center justify-between">
            <span className="text-text-secondary text-xs">
              {localize('com_surveil_credits_remaining')}
            </span>
            <span className="text-text-primary text-sm font-semibold">
              {formatUsd(credits.remainingUSD)}
            </span>
          </div>

          <div
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(percentUsed)}
            className="bg-surface-tertiary h-1.5 w-full overflow-hidden rounded-full"
          >
            <div
              className="bg-text-primary h-full rounded-full transition-all"
              style={{ width: `${percentUsed}%` }}
            />
          </div>

          <span className="text-text-secondary text-xs">
            {localize('com_surveil_credits_used')} {formatUsd(credits.spentUSD)}
            {renews ? ` · ${localize('com_surveil_renews_on')} ${renews}` : ''}
          </span>

          {credits.remainingUSD <= 0 && (
            <span className="text-status-error-strong text-xs" role="alert">
              {localize('com_surveil_exhausted')}
            </span>
          )}
          {credits.remainingUSD > 0 && credits.lowBalance && (
            <span className="text-series-2 text-xs" role="alert">
              {localize('com_surveil_low_balance')}
            </span>
          )}

          <span className="text-text-secondary text-xs">
            {localize('com_surveil_expire_notice')}
          </span>

          <div className="flex gap-1 pt-1">
            <Button
              size="sm"
              variant="ghost"
              disabled={refresh.isLoading}
              onClick={() => refresh.mutate()}
            >
              {localize('com_surveil_refresh')}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={portal.isLoading}
              onClick={() =>
                portal.mutate(undefined, {
                  onSuccess: (data) => redirect(data.url),
                })
              }
            >
              {localize('com_surveil_manage')}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
