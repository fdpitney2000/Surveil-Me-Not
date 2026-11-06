/* Surveil-Me-Not: privacy-tiered hosted subscriptions. */
export { surveilHealth } from './health';
export {
  resolveSurveilConfig,
  endpointForTier,
  tierForEndpoint,
  openRouterKeyName,
  openRouterKeyPrefix,
  isOpenRouterKeyForUser,
  GUARDRAIL_NAMES,
} from './config';
export type { ResolvedSurveilConfig } from './config';
export { SurveilError, SurveilErrorCodes } from './errors';
export type { SurveilErrorCode } from './errors';
export {
  createOpenRouterClient,
  createOpenRouterClientFromEnv,
  OPENROUTER_API_BASE,
} from './openrouter/client';
export type {
  OpenRouterClient,
  OpenRouterApiKey,
  OpenRouterGuardrail,
  OpenRouterModelPricing,
  OpenRouterZdrEndpoint,
} from './openrouter/client';
export {
  resolveGuardrails,
  requireGuardrails,
  enableFilteredModelCatalog,
  guardrailSpec,
  ZDR_FIELDS,
} from './openrouter/guardrails';
export { provisionUserKey, deprovisionUserKeys, setUserKeysDisabled } from './provision';
export { provisionUserOnRegistration } from './registration';
export type { SurveilKeyStore, ProvisionResult, ProvisionedKey } from './provision';
export { deleteUserSurveilKeys } from './deletion';
export { managementKeyExpiryWarning, envManagementKeyExpiryWarning } from './expiry';
export type { ExpiryWarning } from './expiry';
/* Money and period math */
export {
  USD_MICRO,
  usdToMicro,
  microToUsd,
  formatUsd,
  multiplyMicro,
  percentOfMicro,
  stripeFeeMicro,
  grantMicro,
  netProceedsMicro,
  netMarginMicro,
} from './money';
export {
  periodSpendMicro,
  remainingMicro,
  keyLimitMicro,
  shouldDisableForCredits,
} from './period';
/* Plans */
export { resolvePlans, planForPriceId } from './plans';
export type { SurveilPlan, PlanKey } from './plans';
/* Stripe */
export { assertStripeTestMode, createStripeClient, resolveWebhookSecret } from './stripe/client';
export { createCheckoutSession, createPortalSession } from './stripe/checkout';
export { applyStripeEvent, handleStripeWebhook, createDefaultWebhookDeps, nextMonthlyAnniversary } from './stripe/webhook';
export type {
  StripeWebhookDeps,
  SurveilWebhookDb,
  SurveilWebhookLogger,
  ApplyResult,
} from './stripe/webhook';
/* Usage, reconciler, credits, pricing */
export { fetchUserUsage } from './openrouter/usage';
export type { UserUsage, UserKeyUsage } from './openrouter/usage';
export {
  reconcileSubscription,
  reconcileAll,
  startSurveilReconciler,
  isSubscriptionUsable,
} from './reconciler';
export type { SurveilReconcileDb, ReconcileSummary } from './reconciler';
export { buildCreditsResponse } from './credits';
export type { CreditsResponse } from './credits';
export { createPricingService } from './pricing/service';
export type { PricingService, PricingSnapshot, ModelPrice } from './pricing/service';
/* Routes */
export {
  createStripeWebhookHandler,
  createCheckoutHandler,
  createPortalHandler,
  createCreditsHandler,
  createCreditsRefreshHandler,
  createPricingHandlers,
} from './routes';
export type { SurveilRouteDb } from './routes';
/* Landing page */
export { createLandingHandler } from './landing';
export type { LandingHandlerOptions } from './landing';
