const express = require('express');
const { logger } = require('@librechat/data-schemas');
const {
  survielHealth,
  createStripeWebhookHandler,
  createCheckoutHandler,
  createPortalHandler,
} = require('@librechat/api');
const { requireJwtAuth } = require('~/server/middleware');
const db = require('~/models');

const router = express.Router();

const webhook = createStripeWebhookHandler({ db, logger });
const checkout = createCheckoutHandler({ db });
const portal = createPortalHandler({ db });

router.get('/health', survielHealth);

/* Stripe webhook: signature-verified, no JWT. Raw body is captured by the global parser. */
router.post('/stripe/webhook', webhook);

/* Authenticated subscription management. */
router.post('/checkout', requireJwtAuth, checkout);
router.post('/portal', requireJwtAuth, portal);

module.exports = router;
