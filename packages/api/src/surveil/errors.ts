/** Stable, machine-readable codes for Surveil failures surfaced to callers and the UI. */
export const SurveilErrorCodes = {
  NOT_CONFIGURED: 'SURVEIL_NOT_CONFIGURED',
  OPENROUTER_ERROR: 'SURVEIL_OPENROUTER_ERROR',
  GUARDRAIL_MISSING: 'SURVEIL_GUARDRAIL_MISSING',
  PROVISION_FAILED: 'SURVEIL_PROVISION_FAILED',
  NO_SUBSCRIPTION: 'SURVEIL_NO_SUBSCRIPTION',
  CREDITS_EXHAUSTED: 'SURVEIL_CREDITS_EXHAUSTED',
} as const;

export type SurveilErrorCode = (typeof SurveilErrorCodes)[keyof typeof SurveilErrorCodes];

/**
 * A Surveil failure carrying a stable code and an HTTP status. Messages are safe to log
 * and to surface; they must never contain key material or raw upstream payloads.
 */
export class SurveilError extends Error {
  readonly code: SurveilErrorCode;
  readonly status: number;

  constructor(code: SurveilErrorCode, message: string, status = 500) {
    super(message);
    this.name = 'SurveilError';
    this.code = code;
    this.status = status;
  }
}
