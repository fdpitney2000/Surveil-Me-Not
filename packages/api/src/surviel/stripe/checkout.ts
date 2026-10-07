import type Stripe from 'stripe';
import type { SurvielPlan } from '../plans';

export interface CheckoutSessionInput {
  userId: string;
  plan: SurvielPlan;
  customerId?: string;
  successUrl: string;
  cancelUrl: string;
}

/** Create a subscription-mode Checkout Session, tagging it with the LibreChat user id. */
export async function createCheckoutSession(
  stripe: Stripe,
  input: CheckoutSessionInput,
): Promise<Stripe.Checkout.Session> {
  return await stripe.checkout.sessions.create({
    mode: 'subscription',
    line_items: [{ price: input.plan.priceId, quantity: 1 }],
    client_reference_id: input.userId,
    metadata: { userId: input.userId, plan: input.plan.key },
    subscription_data: { metadata: { userId: input.userId, plan: input.plan.key } },
    ...(input.customerId ? { customer: input.customerId } : {}),
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
  });
}

/** Create a Billing Portal session so a user can manage or upgrade their subscription. */
export async function createPortalSession(
  stripe: Stripe,
  input: { customerId: string; returnUrl: string },
): Promise<Stripe.BillingPortal.Session> {
  return await stripe.billingPortal.sessions.create({
    customer: input.customerId,
    return_url: input.returnUrl,
  });
}
