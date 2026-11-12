import { Skeleton, Button } from '@librechat/client';
import AutoRefillSettings from '../SettingsTabs/Balance/AutoRefillSettings';
import {
  useCreateSurveilCheckout,
  useCreateSurveilPortal,
  useGetStartupConfig,
  useSurveilCredits,
} from '~/data-provider';
import useBalanceSummary from '~/hooks/useBalanceSummary';
import type { TSurveilPlanKey } from 'librechat-data-provider';
import { formatBalanceAmount } from '~/utils';
import Balance from '~/components/Balance';
import { useLocalize } from '~/hooks';

const SURVEIL_PLANS: TSurveilPlanKey[] = ['50', '100', '200'];

function formatUsd(value: number): string {
  return `$${value.toFixed(2)}`;
}

function formatPercent(value: number): string {
  return `${Math.round(Math.min(100, Math.max(0, value)))}%`;
}

function formatDate(value: string | null): string {
  if (!value) return '';
  try {
    return new Date(value).toLocaleDateString();
  } catch {
    return '';
  }
}

/** Account → Billing: current Surveil plan, remaining credit, and the Stripe portal. */
export function SurveilPlan() {
  const localize = useLocalize();
  const { data: startupConfig } = useGetStartupConfig();
  const enabled = startupConfig?.surveil?.enabled === true;
  const { data: credits } = useSurveilCredits({ enabled });
  const checkout = useCreateSurveilCheckout();
  const portal = useCreateSurveilPortal();

  if (!enabled) {
    return null;
  }

  if (!credits) {
    return (
      <div className="space-y-2" aria-busy="true" data-testid="surveil-plan-loading">
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-4 w-2/3" />
      </div>
    );
  }

  const hasSubscription = credits.status !== 'none';
  const renews = formatDate(credits.renewsAt);
  const percentRemaining =
    credits.grantUSD > 0 ? (credits.remainingUSD / credits.grantUSD) * 100 : 0;
  const go = (url: string | null | undefined) => {
    if (url) window.location.href = url;
  };

  return (
    <div className="flex flex-col gap-2" data-testid="surveil-plan-settings">
      <div className="flex items-center justify-between gap-3">
        <span className="text-text-secondary text-sm">{localize('com_surveil_current_plan')}</span>
        <span className="text-text-primary text-sm font-medium">
          {hasSubscription && credits.plan ? `$${credits.plan}/mo` : localize('com_surveil_no_plan')}
        </span>
      </div>
      {hasSubscription && (
        <>
          <div className="flex items-center justify-between gap-3">
            <span className="text-text-secondary text-sm">
              {localize('com_surveil_credits_remaining')}
            </span>
            <span className="text-text-primary text-sm font-medium">
              {formatPercent(percentRemaining)}
            </span>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-text-secondary text-sm">{localize('com_surveil_status')}</span>
            <span className="text-text-primary text-sm capitalize">{credits.status}</span>
          </div>
          {renews && (
            <div className="flex items-center justify-between gap-3">
              <span className="text-text-secondary text-sm">{localize('com_surveil_renews_on')}</span>
              <span className="text-text-primary text-sm">{renews}</span>
            </div>
          )}
        </>
      )}
      {!hasSubscription ? (
        <div className="flex flex-col gap-1 pt-1">
          <span className="text-text-secondary text-xs">{localize('com_surveil_pick_plan')}</span>
          <div className="flex gap-1">
            {SURVEIL_PLANS.map((plan) => (
              <Button
                key={plan}
                size="sm"
                variant="outline"
                disabled={checkout.isLoading}
                onClick={() =>
                  checkout.mutate(
                    { plan },
                    {
                      onSuccess: (data) => go(data.url),
                    },
                  )
                }
              >
                {formatUsd(Number(plan))}
              </Button>
            ))}
          </div>
        </div>
      ) : (
        <div className="flex gap-1 pt-1">
          <Button
            size="sm"
            variant="outline"
            disabled={portal.isLoading}
            onClick={() =>
              portal.mutate(undefined, {
                onSuccess: (data) => go(data.url),
              })
            }
          >
            {localize('com_surveil_manage')}
          </Button>
        </div>
      )}
    </div>
  );
}

/** The same reading the context gauge shows, so both surfaces agree. */
export function TokenCredits() {
  return <Balance />;
}

export function AutoRefill() {
  const localize = useLocalize();
  const { state, currency, balance } = useBalanceSummary();

  /** Settings search can show this row without the balance row beside it, so it carries its
   *  own loading and failure states rather than relying on the summary's */
  if (state.status === 'loading') {
    return (
      <div className="space-y-2" aria-busy="true" data-testid="auto-refill-loading">
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-4 w-2/3" />
      </div>
    );
  }
  if (state.status === 'error') {
    return (
      <div className="text-text-destructive text-sm" role="alert">
        {localize('com_nav_balance_auto_refill_error')}
      </div>
    );
  }
  if (state.status !== 'success' || balance == null) {
    return null;
  }

  const { summary } = state;
  const { lastRefill, refillIntervalUnit, refillIntervalValue } = balance;

  /** A non-positive refill amount never refills (the server requires a positive one), the same
   *  reading the balance summary gives it */
  if (!balance.autoRefillEnabled || summary.refillAmount == null) {
    return (
      <div className="text-text-secondary text-sm">
        {localize('com_nav_balance_auto_refill_disabled')}
      </div>
    );
  }

  if (
    lastRefill === undefined ||
    refillIntervalUnit === undefined ||
    refillIntervalValue === undefined
  ) {
    return (
      <div className="text-text-destructive text-sm">
        {localize('com_nav_balance_auto_refill_error')}
      </div>
    );
  }

  return (
    <AutoRefillSettings
      refillMode={summary.refillMode}
      lastRefill={lastRefill}
      nextRefill={summary.nextRefill}
      /** Percent-only deployments show no credit figures anywhere */
      refillAmount={
        summary.display === 'percent'
          ? null
          : formatBalanceAmount(summary.refillAmount, summary.display, currency)
      }
      refillIntervalUnit={refillIntervalUnit}
      refillIntervalValue={refillIntervalValue}
    />
  );
}
