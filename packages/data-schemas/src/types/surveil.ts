import type { Document, Types } from 'mongoose';

export type SurveilSubscriptionStatus =
  | 'active'
  | 'past_due'
  | 'grace'
  | 'disabled'
  | 'canceled'
  | 'review';

/** Cumulative OpenRouter lifetime usage per tier, in micro-USD. */
export interface ISurveilTierUsage {
  tier1: number;
  tier2: number;
  tier3: number;
}

export interface ISurveilSubscription extends Document {
  userId: Types.ObjectId;
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
  priceId?: string;
  plan?: string;
  status: SurveilSubscriptionStatus;
  periodStart?: Date;
  renewsAt?: Date;
  grantMicroUsd: number;
  /** Per-tier lifetime usage snapshot captured at period start. */
  snapshotByTier: ISurveilTierUsage;
  /** Last-known per-tier lifetime usage, refreshed by the reconciler. */
  usageByTier: ISurveilTierUsage;
  activeTier: number;
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
  snapshotByTier: ISurveilTierUsage;
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
