import {
  endpointForTier,
  isOpenRouterKeyForUser,
  openRouterKeyName,
  openRouterKeyPrefix,
  resolveSurveilConfig,
  tierForEndpoint,
} from './config';

describe('resolveSurveilConfig', () => {
  afterEach(() => {
    delete process.env.SURVEIL_ENABLED;
    delete process.env.RETENTION_PCT;
    delete process.env.STRIPE_FEE_PCT;
    delete process.env.STRIPE_FEE_FIXED;
    delete process.env.OPENROUTER_FEE_PCT;
    delete process.env.SURVEIL_RECONCILE_INTERVAL_MS;
  });

  it('applies schema defaults', () => {
    const config = resolveSurveilConfig({});
    expect(config.enabled).toBe(false);
    expect(config.reconcileIntervalMs).toBe(120_000);
    expect(config.retentionPct).toBe(20);
    expect(config.stripeFeePct).toBe(2.9);
    expect(config.stripeFeeFixedUsd).toBe(0.3);
    expect(config.openrouterFeePct).toBe(5.5);
    expect(config.tiers).toHaveLength(3);
  });

  it('overlays fee env overrides', () => {
    process.env.SURVEIL_ENABLED = 'true';
    process.env.RETENTION_PCT = '25';
    process.env.STRIPE_FEE_PCT = '3.1';
    process.env.STRIPE_FEE_FIXED = '0.35';
    process.env.OPENROUTER_FEE_PCT = '6';
    process.env.SURVEIL_RECONCILE_INTERVAL_MS = '60000';
    const config = resolveSurveilConfig({});
    expect(config.enabled).toBe(true);
    expect(config.retentionPct).toBe(25);
    expect(config.stripeFeePct).toBe(3.1);
    expect(config.stripeFeeFixedUsd).toBe(0.35);
    expect(config.openrouterFeePct).toBe(6);
    expect(config.reconcileIntervalMs).toBe(60_000);
  });
});

describe('tier helpers', () => {
  const config = resolveSurveilConfig({});

  it('maps tiers to endpoints and back', () => {
    expect(endpointForTier(config, 3)).toBe('Enterprise Vault');
    expect(tierForEndpoint(config, 'Commercial Privacy')).toBe(2);
    expect(tierForEndpoint(config, 'not-a-tier')).toBeUndefined();
  });

  it('builds one stable key name per user and matches legacy keys', () => {
    expect(openRouterKeyName('abc')).toBe('surveil:abc');
    expect(openRouterKeyPrefix('abc')).toBe('surveil:abc');
    expect(isOpenRouterKeyForUser('surveil:abc', 'abc')).toBe(true);
    expect(isOpenRouterKeyForUser('surveil:abc:2', 'abc')).toBe(true);
    expect(isOpenRouterKeyForUser('surveil:abcdef', 'abc')).toBe(false);
  });
});
