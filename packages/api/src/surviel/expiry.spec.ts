import { managementKeyExpiryWarning } from './expiry';

describe('managementKeyExpiryWarning', () => {
  const now = new Date('2025-06-01T00:00:00Z');

  it('warns inside the window', () => {
    const warning = managementKeyExpiryWarning({
      expiresAt: '2025-06-10T00:00:00Z',
      warnDays: 14,
      now,
    });
    expect(warning?.daysRemaining).toBe(9);
    expect(warning?.message).toContain('expires in 9 day');
  });

  it('stays silent outside the window', () => {
    expect(
      managementKeyExpiryWarning({ expiresAt: '2025-08-01T00:00:00Z', warnDays: 14, now }),
    ).toBeUndefined();
  });

  it('flags an already-expired key', () => {
    const warning = managementKeyExpiryWarning({
      expiresAt: '2025-05-20T00:00:00Z',
      warnDays: 14,
      now,
    });
    expect(warning?.message).toContain('expired');
  });

  it('ignores an unset or invalid expiry', () => {
    expect(managementKeyExpiryWarning({ expiresAt: undefined, warnDays: 14, now })).toBeUndefined();
    expect(
      managementKeyExpiryWarning({ expiresAt: 'not-a-date', warnDays: 14, now }),
    ).toBeUndefined();
  });
});
