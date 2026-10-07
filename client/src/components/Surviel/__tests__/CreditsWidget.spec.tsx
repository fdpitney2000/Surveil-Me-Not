import React from 'react';
import userEvent from '@testing-library/user-event';
import { render, screen } from '@testing-library/react';
import type { TSurvielCredits } from 'librechat-data-provider';
import CreditsWidget from '../CreditsWidget';

const activeCredits: TSurvielCredits = {
  plan: '100',
  status: 'active',
  periodStart: '2025-06-01T00:00:00.000Z',
  renewsAt: '2025-07-01T00:00:00.000Z',
  grantUSD: 90,
  spentUSD: 12.5,
  remainingUSD: 77.5,
  perTier: { tier1: 1, tier2: 2, tier3: 9.5 },
  lastSyncedAt: '2025-06-10T00:00:00.000Z',
  lowBalance: false,
};

const noSub: TSurvielCredits = {
  plan: null,
  status: 'none',
  periodStart: null,
  renewsAt: null,
  grantUSD: 0,
  spentUSD: 0,
  remainingUSD: 0,
  perTier: { tier1: 0, tier2: 0, tier3: 0 },
  lastSyncedAt: null,
  lowBalance: false,
};

const mockState = {
  enabled: true,
  credits: activeCredits,
};

jest.mock('~/data-provider', () => ({
  useGetStartupConfig: () => ({ data: { surviel: { enabled: mockState.enabled } } }),
  useSurvielCredits: () => ({ data: mockState.credits }),
  useRefreshSurvielCredits: () => ({ mutate: jest.fn(), isLoading: false }),
  useCreateSurvielCheckout: () => ({ mutate: jest.fn(), isLoading: false }),
  useCreateSurvielPortal: () => ({ mutate: jest.fn(), isLoading: false }),
}));

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => key,
}));

describe('CreditsWidget', () => {
  beforeEach(() => {
    mockState.enabled = true;
    mockState.credits = activeCredits;
  });

  it('renders nothing when Surviel is disabled', () => {
    mockState.enabled = false;
    const { container } = render(<CreditsWidget />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the remaining balance and used amount', () => {
    render(<CreditsWidget />);
    expect(screen.getByText('$77.50')).toBeInTheDocument();
    expect(screen.getByText(/com_surviel_credits_used/)).toBeInTheDocument();
  });

  it('reveals the per-tier breakdown on click', async () => {
    render(<CreditsWidget />);
    expect(screen.queryByText('com_surviel_tier_breakdown')).not.toBeInTheDocument();
    await userEvent.click(screen.getByText('com_surviel_credits_remaining'));
    expect(screen.getByText('com_surviel_tier_breakdown')).toBeInTheDocument();
  });

  it('shows a subscribe prompt when there is no subscription', () => {
    mockState.credits = noSub;
    render(<CreditsWidget />);
    expect(screen.getByText('com_surviel_no_subscription')).toBeInTheDocument();
    expect(screen.getByText('$50.00')).toBeInTheDocument();
  });
});
