import type { Document, Types } from 'mongoose';

export type SurveilSubscriptionStatus =
  | 'active'
  | 'past_due'
  | 'grace'
  | 'disabled'
  | 'canceled'
  | 'review';

export interface ISurveilSubscription extends Document {
  userId: Types.ObjectId;
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
  priceId?: string;
  plan?: string;
  status: SurveilSubscriptionStatus;
  periodStart?: Date;
  renewsAt?: Date;
  /** The net amount loaded onto the current OpenRouter key, in micro-USD. */
  grantMicroUsd: number;
  /** Cumulative key usage at the start of the current period, in micro-USD. */
  snapshotUsageMicro: number;
  /** Last-known cumulative key usage, refreshed by the reconciler, in micro-USD. */
  usageMicro: number;
  /** OpenRouter key hash for the current period. */
  keyHash?: string;
  /** OpenRouter key expiration (the current period end). */
  keyExpiresAt?: Date | null;
  /** The limit set on the current key, in micro-USD. */
  keyLimitMicroUsd?: number;
  graceUntil?: Date | null;
  flaggedForReview: boolean;
  lastSyncedAt?: Date | null;
  /** Stripe `event.created` of the most recently applied event, for out-of-order tolerance. */
  lastEventCreatedAt?: number | null;
  tenantId?: string;
}

export interface ISurveilPeriod extends Document {
  userId: Types.ObjectId;
  invoiceId: string;
  plan?: string;
  grantMicroUsd: number;
  snapshotUsageMicro: number;
  periodStart?: Date;
  periodEnd?: Date;
  kind: 'cycle' | 'proration';
  tenantId?: string;
}

export interface ISurveilEvent extends Document {
  eventId: string;
  type: string;
  created: number;
  processedAt: Date;
  status: 'processed' | 'ignored' | 'error';
  note?: string;
}
