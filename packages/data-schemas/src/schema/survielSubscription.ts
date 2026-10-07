import { Schema } from 'mongoose';
import type { ISurvielSubscription, ISurvielTierUsage } from '~/types';

const tierUsageSchema = new Schema<ISurvielTierUsage>(
  {
    tier1: { type: Number, default: 0 },
    tier2: { type: Number, default: 0 },
    tier3: { type: Number, default: 0 },
  },
  { _id: false },
);

const survielSubscriptionSchema: Schema<ISurvielSubscription> = new Schema<ISurvielSubscription>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    stripeCustomerId: { type: String, index: true },
    stripeSubscriptionId: { type: String, index: true },
    priceId: { type: String },
    plan: { type: String },
    status: {
      type: String,
      enum: ['active', 'past_due', 'grace', 'disabled', 'canceled', 'review'],
      default: 'active',
      index: true,
    },
    periodStart: { type: Date },
    renewsAt: { type: Date },
    grantMicroUsd: { type: Number, default: 0 },
    snapshotByTier: { type: tierUsageSchema, default: () => ({ tier1: 0, tier2: 0, tier3: 0 }) },
    usageByTier: { type: tierUsageSchema, default: () => ({ tier1: 0, tier2: 0, tier3: 0 }) },
    activeTier: { type: Number, default: 1 },
    graceUntil: { type: Date, default: null },
    flaggedForReview: { type: Boolean, default: false },
    lastSyncedAt: { type: Date, default: null },
    lastEventCreatedAt: { type: Number, default: null },
    tenantId: { type: String, index: true },
  },
  { timestamps: true },
);

survielSubscriptionSchema.index({ userId: 1, tenantId: 1 }, { unique: true });

export default survielSubscriptionSchema;
