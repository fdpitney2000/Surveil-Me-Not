import Stripe from 'stripe';
import { SurvielError, SurvielErrorCodes } from '../errors';

/**
 * Refuse to operate on a live Stripe key unless explicitly allowed. Test keys (`sk_test_`)
 * and restricted test keys pass through.
 */
export function assertStripeTestMode(secretKey: string, allowLive: boolean): void {
  if (secretKey.startsWith('sk_live_') && !allowLive) {
    throw new SurvielError(
      SurvielErrorCodes.NOT_CONFIGURED,
      'Refusing to start with a live Stripe key. Set SURVIEL_ALLOW_LIVE_STRIPE=true to override.',
      500,
    );
  }
}

export interface CreateStripeClientOptions {
  secretKey?: string;
  allowLive?: boolean;
}

/** Build a Stripe client from options or env, enforcing the test-mode guard. */
export function createStripeClient(options: CreateStripeClientOptions = {}): Stripe {
  const secretKey = options.secretKey ?? process.env.STRIPE_SECRET_KEY ?? '';
  const allowLive = options.allowLive ?? process.env.SURVIEL_ALLOW_LIVE_STRIPE === 'true';
  if (!secretKey) {
    throw new SurvielError(
      SurvielErrorCodes.NOT_CONFIGURED,
      'STRIPE_SECRET_KEY is not configured.',
      503,
    );
  }
  assertStripeTestMode(secretKey, allowLive);
  return new Stripe(secretKey);
}

/** The active webhook signing secret, chosen by SURVIEL_STRIPE_WEBHOOK_SOURCE. */
export function resolveWebhookSecret(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const source = (env.SURVIEL_STRIPE_WEBHOOK_SOURCE ?? 'cli').toLowerCase();
  if (source === 'dashboard') return env.STRIPE_WEBHOOK_SECRET;
  if (source === 'cli') return env.STRIPE_WEBHOOK_SECRET_LOCAL ?? env.STRIPE_WEBHOOK_SECRET;
  return env.STRIPE_WEBHOOK_SECRET_LOCAL ?? env.STRIPE_WEBHOOK_SECRET;
}
