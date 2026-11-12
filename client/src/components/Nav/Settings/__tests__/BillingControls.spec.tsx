import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SurveilPlan } from '../BillingControls';

const mockCheckoutMutate = jest.fn();
const mockPortalMutate = jest.fn();
let mockStartupConfig: unknown;
let mockCredits: unknown;

jest.mock('~/data-provider', () => ({
  useGetStartupConfig: () => ({ data: mockStartupConfig }),
  useSurveilCredits: () => ({ data: mockCredits }),
  useCreateSurveilCheckout: () => ({ isLoading: false, mutate: mockCheckoutMutate }),
  useCreateSurveilPortal: () => ({ isLoading: false, mutate: mockPortalMutate }),
}));

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => key,
}));

jest.mock('~/hooks/useBalanceSummary', () => () => ({}));
jest.mock('~/components/Balance', () => () => null);
jest.mock('../../SettingsTabs/Balance/AutoRefillSettings', () => () => null);

describe('SurveilPlan settings', () => {
  beforeEach(() => {
    mockCheckoutMutate.mockClear();
    mockPortalMutate.mockClear();
    mockStartupConfig = { surveil: { enabled: true } };
    mockCredits = {
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
  });

  it('offers the plan picker when there is no subscription', async () => {
    render(<SurveilPlan />);

    expect(screen.getByText('com_surveil_no_plan')).toBeInTheDocument();
    expect(screen.getByText('$50.00')).toBeInTheDocument();
    await userEvent.click(screen.getByText('$50.00'));
    expect(mockCheckoutMutate).toHaveBeenCalledWith({ plan: '50' }, expect.any(Object));
  });

  it('shows the active plan and opens the Stripe portal', async () => {
    mockCredits = {
      plan: '100',
      status: 'active',
      periodStart: '2026-11-01T00:00:00.000Z',
      renewsAt: '2026-12-01T00:00:00.000Z',
      grantUSD: 100,
      spentUSD: 20,
      remainingUSD: 80,
      lastSyncedAt: null,
      lowBalance: false,
    };

    render(<SurveilPlan />);

    expect(screen.getByText('$100/mo')).toBeInTheDocument();
    expect(screen.getByText('80%')).toBeInTheDocument();
    await userEvent.click(screen.getByText('com_surveil_manage'));
    expect(mockPortalMutate).toHaveBeenCalled();
  });
});
