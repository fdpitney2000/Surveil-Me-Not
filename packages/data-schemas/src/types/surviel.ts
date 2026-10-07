import type { Document, Types } from 'mongoose';

export type SurvielSubscriptionStatus =
  | 'active'
  | 'past_due'
  | 'grace'
  | 'disabled'
  | 'canceled'
  | 'review';

/** Cumulative OpenRouter lifetime usage per tier, in micro-USD. */
export interface ISurvielTierUsage {
  tier1: number;
  tier2: number;
  tier3: number;
}

export interface ISurvielSubscription extends Document {
  userId: Types.ObjectId;
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
  priceId?: string;
  plan?: string;
  status: SurvielSubscriptionStatus;
  periodStart?: Date;
  renewsAt?: Date;
  grantMicroUsd: number;
  /** Per-tier lifetime usage snapshot captured at period start. */
  snapshotByTier: ISurvielTierUsage;
  /** Last-known per-tier lifetime usage, refreshed by the reconciler. */
  usageByTier: ISurvielTierUsage;
  activeTier: number;
  graceUntil?: Date | null;
  flaggedForReview: boolean;
  lastSyncedAt?: Date | null;
  /** Stripe `event.created` of the most recently applied event, for out-of-order tolerance. */
  lastEventCreatedAt?: number | null;
  tenantId?: string;
}

export interface ISurvielPeriod extends Document {
  userId: Types.ObjectId;
  invoiceId: string;
  plan?: string;
  grantMicroUsd: number;
  snapshotByTier: ISurvielTierUsage;
  periodStart?: Date;
  periodEnd?: Date;
  kind: 'cycle' | 'proration';
  tenantId?: string;
}

export interface ISurvielEvent extends Document {
  eventId: string;
  type: string;
  created: number;
  processedAt: Date;
  status: 'processed' | 'ignored' | 'error';
  note?: string;
}
