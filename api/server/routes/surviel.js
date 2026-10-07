const express = require('express');
const { logger } = require('@librechat/data-schemas');
const {
  survielHealth,
  createStripeWebhookHandler,
  createCheckoutHandler,
  createPortalHandler,
  createCreditsHandler,
  createCreditsRefreshHandler,
  createPricingHandlers,
} = require('@librechat/api');
const { requireJwtAuth } = require('~/server/middleware');
const db = require('~/models');

const router = express.Router();

const webhook = createStripeWebhookHandler({ db, logger });
const checkout = createCheckoutHandler({ db });
const portal = createPortalHandler({ db });
const credits = createCreditsHandler({ db, logger });
const creditsRefresh = createCreditsRefreshHandler({ db, logger });
const pricing = createPricingHandlers({ logger });

router.get('/health', survielHealth);

/* Stripe webhook: signature-verified, no JWT. Raw body is captured before the JSON parser. */
router.post('/stripe/webhook', webhook);

/* Authenticated subscription and credit surfaces. */
router.post('/checkout', requireJwtAuth, checkout);
router.post('/portal', requireJwtAuth, portal);
router.get('/credits', requireJwtAuth, credits);
router.post('/credits/refresh', requireJwtAuth, creditsRefresh);
router.get('/pricing', pricing.get);
router.post('/pricing/refresh', requireJwtAuth, pricing.refresh);

module.exports = router;
