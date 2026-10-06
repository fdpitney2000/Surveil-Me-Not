import {
  endpointForTier,
  openRouterKeyName,
  openRouterKeyPrefix,
  resolveSurvielConfig,
  tierForEndpoint,
} from './config';

describe('resolveSurvielConfig', () => {
  afterEach(() => {
    delete process.env.SURVIEL_ENABLED;
    delete process.env.CREDIT_GRANT_RATIO;
    delete process.env.SURVIEL_RECONCILE_INTERVAL_MS;
  });

  it('applies schema defaults', () => {
    const config = resolveSurvielConfig({});
    expect(config.enabled).toBe(false);
    expect(config.reconcileIntervalMs).toBe(120_000);
    expect(config.keyLimitMode).toBe('allocate');
    expect(config.tiers).toHaveLength(3);
  });

  it('overlays env overrides', () => {
    process.env.SURVIEL_ENABLED = 'true';
    process.env.CREDIT_GRANT_RATIO = '0.8';
    process.env.SURVIEL_RECONCILE_INTERVAL_MS = '60000';
    const config = resolveSurvielConfig({});
    expect(config.enabled).toBe(true);
    expect(config.creditGrantRatio).toBe(0.8);
    expect(config.reconcileIntervalMs).toBe(60_000);
  });
});

describe('tier helpers', () => {
  const config = resolveSurvielConfig({});

  it('maps tiers to endpoints and back', () => {
    expect(endpointForTier(config, 3)).toBe('Enterprise Vault');
    expect(tierForEndpoint(config, 'Commercial Privacy')).toBe(2);
    expect(tierForEndpoint(config, 'not-a-tier')).toBeUndefined();
  });

  it('builds stable key names', () => {
    expect(openRouterKeyName('abc', 2)).toBe('surviel:abc:2');
    expect(openRouterKeyPrefix('abc')).toBe('surviel:abc:');
  });
});
