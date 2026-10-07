import type { Request, Response } from 'express';
import type { SurvielWebhookDb, SurvielWebhookLogger } from './stripe/webhook';
import type { PricingService } from './pricing/service';
import type { SurvielReconcileDb } from './reconciler';
import type { ResolvedSurvielConfig } from './config';
import { createDefaultWebhookDeps, handleStripeWebhook } from './stripe/webhook';
import { createCheckoutSession, createPortalSession } from './stripe/checkout';
import { createOpenRouterClientFromEnv } from './openrouter/client';
import { SurvielError, SurvielErrorCodes } from './errors';
import { createPricingService } from './pricing/service';
import { reconcileSubscription } from './reconciler';
import { createStripeClient } from './stripe/client';
import { buildCreditsResponse } from './credits';
import { resolveSurvielConfig } from './config';
import { resolvePlans } from './plans';

type RequestWithRawBody = Request & { rawBody?: Buffer; user?: { id: string } };

/** The database methods the Surviel routes need. */
export type SurvielRouteDb = SurvielWebhookDb & SurvielReconcileDb;

function defaultDomain(): string {
  return process.env.DOMAIN_CLIENT ?? 'http://localhost:3080';
}

/** Express handler for `POST /api/surviel/stripe/webhook` (raw body already captured). */
export function createStripeWebhookHandler(options: {
  db: SurvielWebhookDb;
  logger?: SurvielWebhookLogger;
}): (req: Request, res: Response) => Promise<void> {
  /* Build dependencies lazily: a deployment without Stripe keys must still start. */
  let deps: ReturnType<typeof createDefaultWebhookDeps> | undefined;
  const getDeps = () => {
    if (!deps) {
      deps = createDefaultWebhookDeps({ db: options.db, logger: options.logger });
    }
    return deps;
  };
  return async (req, res) => {
    const request = req as RequestWithRawBody;
    try {
      const signature = req.headers['stripe-signature'];
      const rawBody = request.rawBody ?? (Buffer.isBuffer(req.body) ? req.body : undefined);
      if (!rawBody) {
        res.status(400).json({ error: SurvielErrorCodes.NOT_CONFIGURED });
        return;
      }
      const result = await handleStripeWebhook({
        rawBody,
        signature: typeof signature === 'string' ? signature : undefined,
        deps: getDeps(),
      });
      res.status(200).json({ received: true, handled: result.handled });
    } catch (error) {
      if (error instanceof SurvielError) {
        res.status(error.status).json({ error: error.code });
        return;
      }
      options.logger?.warn('[Surviel] Webhook handling failed:', error);
      res.status(400).json({ error: SurvielErrorCodes.OPENROUTER_ERROR });
    }
  };
}

/** Express handler for `POST /api/surviel/checkout`. */
export function createCheckoutHandler(options: {
  db: SurvielWebhookDb;
}): (req: Request, res: Response) => Promise<void> {
  return async (req, res) => {
    const user = (req as RequestWithRawBody).user;
    if (!user?.id) {
      res.status(401).json({ error: 'UNAUTHORIZED' });
      return;
    }
    const planKey = (req.body?.plan ?? '') as string;
    const plans = resolvePlans();
    const plan = plans.find((entry) => entry.key === planKey) ?? plans[0];
    if (!plan) {
      res.status(503).json({ error: SurvielErrorCodes.NOT_CONFIGURED });
      return;
    }
    try {
      const stripe = createStripeClient();
      const existing = await options.db.getSurvielSubscriptionByUser(user.id);
      const domain = defaultDomain();
      const session = await createCheckoutSession(stripe, {
        userId: user.id,
        plan,
        customerId: existing?.stripeCustomerId ?? undefined,
        successUrl: `${domain}/c/new?checkout=success`,
        cancelUrl: `${domain}/c/new?checkout=canceled`,
      });
      res.status(200).json({ url: session.url, id: session.id });
    } catch (error) {
      if (error instanceof SurvielError) {
        res.status(error.status).json({ error: error.code });
        return;
      }
      res.status(502).json({ error: SurvielErrorCodes.OPENROUTER_ERROR });
    }
  };
}

/** Express handler for `POST /api/surviel/portal`. */
export function createPortalHandler(options: {
  db: SurvielWebhookDb;
}): (req: Request, res: Response) => Promise<void> {
  return async (req, res) => {
    const user = (req as RequestWithRawBody).user;
    if (!user?.id) {
      res.status(401).json({ error: 'UNAUTHORIZED' });
      return;
    }
    try {
      const existing = await options.db.getSurvielSubscriptionByUser(user.id);
      if (!existing?.stripeCustomerId) {
        res.status(404).json({ error: SurvielErrorCodes.NO_SUBSCRIPTION });
        return;
      }
      const stripe = createStripeClient();
      const session = await createPortalSession(stripe, {
        customerId: existing.stripeCustomerId,
        returnUrl: `${defaultDomain()}/c/new`,
      });
      res.status(200).json({ url: session.url });
    } catch (error) {
      if (error instanceof SurvielError) {
        res.status(error.status).json({ error: error.code });
        return;
      }
      res.status(502).json({ error: SurvielErrorCodes.OPENROUTER_ERROR });
    }
  };
}

/** Express handler for `GET /api/surviel/credits`. */
export function createCreditsHandler(options: {
  db: SurvielRouteDb;
  config?: ResolvedSurvielConfig;
}): (req: Request, res: Response) => Promise<void> {
  const config = options.config ?? resolveSurvielConfig();
  return async (req, res) => {
    const user = (req as RequestWithRawBody).user;
    if (!user?.id) {
      res.status(401).json({ error: 'UNAUTHORIZED' });
      return;
    }
    const subscription = await options.db.getSurvielSubscriptionByUser(user.id);
    res.status(200).json(
      buildCreditsResponse({
        subscription,
        lowBalanceThresholdUsd: config.lowBalanceThresholdUsd,
      }),
    );
  };
}

/** Express handler for `POST /api/surviel/credits/refresh` (on-demand reconcile). */
export function createCreditsRefreshHandler(options: {
  db: SurvielRouteDb;
  config?: ResolvedSurvielConfig;
  logger?: SurvielWebhookLogger;
}): (req: Request, res: Response) => Promise<void> {
  const config = options.config ?? resolveSurvielConfig();
  return async (req, res) => {
    const user = (req as RequestWithRawBody).user;
    if (!user?.id) {
      res.status(401).json({ error: 'UNAUTHORIZED' });
      return;
    }
    const subscription = await options.db.getSurvielSubscriptionByUser(user.id);
    const client = createOpenRouterClientFromEnv();
    if (subscription && client) {
      try {
        await reconcileSubscription({ db: options.db, client, config, subscription });
      } catch (error) {
        options.logger?.warn('[Surviel] On-demand reconcile failed:', error);
      }
    }
    const fresh = await options.db.getSurvielSubscriptionByUser(user.id);
    res.status(200).json(
      buildCreditsResponse({
        subscription: fresh,
        lowBalanceThresholdUsd: config.lowBalanceThresholdUsd,
      }),
    );
  };
}

/** Lazily create a pricing service from env for the pricing routes. */
export function createPricingHandlers(options: {
  config?: ResolvedSurvielConfig;
  logger?: SurvielWebhookLogger;
}): {
  get: (req: Request, res: Response) => Promise<void>;
  refresh: (req: Request, res: Response) => Promise<void>;
} {
  const config = options.config ?? resolveSurvielConfig();
  let service: PricingService | null = null;
  const getService = (): PricingService | null => {
    if (service) return service;
    const client = createOpenRouterClientFromEnv();
    if (!client) return null;
    service = createPricingService({
      client,
      ttlMs: config.pricingTtlMs,
      logger: options.logger,
    });
    return service;
  };

  return {
    async get(_req, res) {
      const pricing = getService();
      if (!pricing) {
        res.status(200).json({ models: {}, fetchedAt: null });
        return;
      }
      const snapshot = await pricing.get();
      res
        .status(200)
        .json(
          snapshot
            ? { models: snapshot.models, fetchedAt: new Date(snapshot.fetchedAt).toISOString() }
            : { models: {}, fetchedAt: null },
        );
    },
    async refresh(_req, res) {
      const pricing = getService();
      if (!pricing) {
        res.status(503).json({ error: SurvielErrorCodes.NOT_CONFIGURED });
        return;
      }
      try {
        const snapshot = await pricing.refresh();
        res.status(200).json({
          models: snapshot.models,
          fetchedAt: new Date(snapshot.fetchedAt).toISOString(),
        });
      } catch (error) {
        options.logger?.warn('[Surviel] Manual pricing refresh failed:', error);
        res.status(502).json({ error: SurvielErrorCodes.OPENROUTER_ERROR });
      }
    },
  };
}
