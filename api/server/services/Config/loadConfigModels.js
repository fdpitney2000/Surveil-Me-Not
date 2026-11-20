const { createLoadConfigModels, fetchModels } = require('@librechat/api');
const { getAppConfig } = require('./app');
const db = require('~/models');

const loadConfigModels = createLoadConfigModels({
  getAppConfig,
  getUserKeyValues: db.getUserKeyValues,
  getSurveilSubscriptionByUser: db.getSurveilSubscriptionByUser,
  fetchModels,
});

module.exports = loadConfigModels;
