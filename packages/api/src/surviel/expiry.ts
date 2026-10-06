export interface ExpiryWarning {
  expiresAt: Date;
  daysRemaining: number;
  message: string;
}

/**
 * Return a warning when the management key expires within `warnDays`. Management keys cannot
 * be extended in place; rotation means setting a new env value. Returns undefined when the
 * expiry is unknown or far away.
 */
export function managementKeyExpiryWarning(options: {
  expiresAt?: string | null;
  warnDays: number;
  now?: Date;
}): ExpiryWarning | undefined {
  const { expiresAt, warnDays } = options;
  if (!expiresAt) return undefined;
  const parsed = new Date(expiresAt);
  if (Number.isNaN(parsed.getTime())) return undefined;
  const now = options.now ?? new Date();
  const daysRemaining = Math.floor((parsed.getTime() - now.getTime()) / 86_400_000);
  if (daysRemaining > warnDays) return undefined;
  return {
    expiresAt: parsed,
    daysRemaining,
    message:
      daysRemaining < 0
        ? `OpenRouter management key expired ${Math.abs(daysRemaining)} day(s) ago; rotate it now.`
        : `OpenRouter management key expires in ${daysRemaining} day(s); schedule rotation.`,
  };
}

/** Read `SURVIEL_OPENROUTER_MGMT_KEY_EXPIRES_AT` and evaluate the warning. */
export function envManagementKeyExpiryWarning(
  warnDays: number,
  now?: Date,
): ExpiryWarning | undefined {
  return managementKeyExpiryWarning({
    expiresAt: process.env.SURVIEL_OPENROUTER_MGMT_KEY_EXPIRES_AT,
    warnDays,
    now,
  });
}
