const express = require('express');
const { survielHealth } = require('@librechat/api');

const router = express.Router();

router.get('/health', survielHealth);

module.exports = router;
