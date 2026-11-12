import React from 'react';
import { render, screen } from '@testing-library/react';
import type { TSurveilCredits } from 'librechat-data-provider';
import CreditsWidget from '../CreditsWidget';

const activeCredits: TSurveilCredits = {
  plan: '100',
  status: 'active',
  periodStart: '2025-06-01T00:00:00.000Z',
  renewsAt: '2025-07-01T00:00:00.000Z',
  grantUSD: 71.3,
  spentUSD: 12.5,
  remainingUSD: 58.8,
  lastSyncedAt: '2025-06-10T00:00:00.000Z',
  lowBalance: false,
};

const noSub: TSurveilCredits = {
  plan: null,
  status: 'none',
  periodStart: null,
  renewsAt: null,
  grantUSD: 0,
  spentUSD: 0,
  remainingUSD: 0,
  lastSyncedAt: null,
  lowBalance: false,
};

const mockState = {
  enabled: true,
  credits: activeCredits,
};

jest.mock('~/data-provider', () => ({
  useGetStartupConfig: () => ({ data: { surveil: { enabled: mockState.enabled } } }),
  useSurveilCredits: () => ({ data: mockState.credits }),
  useRefreshSurveilCredits: () => ({ mutate: jest.fn(), isLoading: false }),
  useCreateSurveilCheckout: () => ({ mutate: jest.fn(), isLoading: false }),
  useCreateSurveilPortal: () => ({ mutate: jest.fn(), isLoading: false }),
}));

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => key,
}));

describe('CreditsWidget', () => {
  beforeEach(() => {
    mockState.enabled = true;
    mockState.credits = activeCredits;
  });

  it('renders nothing when Surveil is disabled', () => {
    mockState.enabled = false;
    const { container } = render(<CreditsWidget />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the remaining balance and used amount', () => {
    render(<CreditsWidget />);
    expect(screen.getByText('82%')).toBeInTheDocument();
    expect(screen.getByText(/com_surveil_credits_used/)).toBeInTheDocument();
  });

  it('shows 100% at the start of a period', () => {
    mockState.credits = {
      ...activeCredits,
      spentUSD: 0,
      remainingUSD: activeCredits.grantUSD,
    };
    render(<CreditsWidget />);
    expect(screen.getByText('100%')).toBeInTheDocument();
  });

  it('does not render a per-tier breakdown', () => {
    render(<CreditsWidget />);
    expect(screen.queryByText('com_surveil_tier_breakdown')).not.toBeInTheDocument();
  });

  it('shows a subscribe prompt when there is no subscription', () => {
    mockState.credits = noSub;
    render(<CreditsWidget />);
    expect(screen.getByText('com_surveil_no_subscription')).toBeInTheDocument();
    expect(screen.getByText('$50.00')).toBeInTheDocument();
  });
});
