import { assertStripeTestMode, createStripeClient, resolveWebhookSecret } from './client';
import { SurvielErrorCodes } from '../errors';

describe('assertStripeTestMode', () => {
  it('refuses a live key unless explicitly allowed', () => {
    expect(() => assertStripeTestMode('sk_live_abc', false)).toThrow(
      expect.objectContaining({ code: SurvielErrorCodes.NOT_CONFIGURED }),
    );
    expect(() => assertStripeTestMode('sk_live_abc', true)).not.toThrow();
  });

  it('allows test keys', () => {
    expect(() => assertStripeTestMode('sk_test_abc', false)).not.toThrow();
  });
});

describe('createStripeClient', () => {
  it('throws NOT_CONFIGURED without a key', () => {
    expect(() => createStripeClient({ secretKey: '' })).toThrow(
      expect.objectContaining({ code: SurvielErrorCodes.NOT_CONFIGURED }),
    );
  });
});

describe('resolveWebhookSecret', () => {
  const original = { ...process.env };

  afterEach(() => {
    process.env = { ...original };
  });

  it('selects the CLI secret when source is cli', () => {
    process.env.SURVIEL_STRIPE_WEBHOOK_SOURCE = 'cli';
    process.env.STRIPE_WEBHOOK_SECRET_LOCAL = 'whsec_local';
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_dash';
    expect(resolveWebhookSecret()).toBe('whsec_local');
  });

  it('selects the dashboard secret when source is dashboard', () => {
    process.env.SURVIEL_STRIPE_WEBHOOK_SOURCE = 'dashboard';
    process.env.STRIPE_WEBHOOK_SECRET_LOCAL = 'whsec_local';
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_dash';
    expect(resolveWebhookSecret()).toBe('whsec_dash');
  });
});
