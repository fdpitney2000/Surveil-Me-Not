/** Stable, machine-readable codes for Surviel failures surfaced to callers and the UI. */
export const SurvielErrorCodes = {
  NOT_CONFIGURED: 'SURVIEL_NOT_CONFIGURED',
  OPENROUTER_ERROR: 'SURVIEL_OPENROUTER_ERROR',
  GUARDRAIL_MISSING: 'SURVIEL_GUARDRAIL_MISSING',
  PROVISION_FAILED: 'SURVIEL_PROVISION_FAILED',
  NO_SUBSCRIPTION: 'SURVIEL_NO_SUBSCRIPTION',
  CREDITS_EXHAUSTED: 'SURVIEL_CREDITS_EXHAUSTED',
} as const;

export type SurvielErrorCode = (typeof SurvielErrorCodes)[keyof typeof SurvielErrorCodes];

/**
 * A Surviel failure carrying a stable code and an HTTP status. Messages are safe to log
 * and to surface; they must never contain key material or raw upstream payloads.
 */
export class SurvielError extends Error {
  readonly code: SurvielErrorCode;
  readonly status: number;

  constructor(code: SurvielErrorCode, message: string, status = 500) {
    super(message);
    this.name = 'SurvielError';
    this.code = code;
    this.status = status;
  }
}
