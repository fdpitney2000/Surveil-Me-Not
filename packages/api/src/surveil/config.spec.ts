import {
  endpointForTier,
  openRouterKeyName,
  openRouterKeyPrefix,
  resolveSurveilConfig,
  tierForEndpoint,
} from './config';

describe('resolveSurveilConfig', () => {
  afterEach(() => {
    delete process.env.SURVEIL_ENABLED;
    delete process.env.CREDIT_GRANT_RATIO;
    delete process.env.SURVEIL_RECONCILE_INTERVAL_MS;
  });

  it('applies schema defaults', () => {
    const config = resolveSurveilConfig({});
    expect(config.enabled).toBe(false);
    expect(config.reconcileIntervalMs).toBe(120_000);
    expect(config.keyLimitMode).toBe('allocate');
    expect(config.tiers).toHaveLength(3);
  });

  it('overlays env overrides', () => {
    process.env.SURVEIL_ENABLED = 'true';
    process.env.CREDIT_GRANT_RATIO = '0.8';
    process.env.SURVEIL_RECONCILE_INTERVAL_MS = '60000';
    const config = resolveSurveilConfig({});
    expect(config.enabled).toBe(true);
    expect(config.creditGrantRatio).toBe(0.8);
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

  it('builds stable key names', () => {
    expect(openRouterKeyName('abc', 2)).toBe('surveil:abc:2');
    expect(openRouterKeyPrefix('abc')).toBe('surveil:abc:');
  });
});
