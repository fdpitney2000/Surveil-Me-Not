import { Schema } from 'mongoose';
import type { ISurveilSubscription } from '~/types';

const surveilSubscriptionSchema: Schema<ISurveilSubscription> = new Schema<ISurveilSubscription>(
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
    snapshotUsageMicro: { type: Number, default: 0 },
    usageMicro: { type: Number, default: 0 },
    keyHash: { type: String },
    keyExpiresAt: { type: Date, default: null },
    keyLimitMicroUsd: { type: Number },
    graceUntil: { type: Date, default: null },
    flaggedForReview: { type: Boolean, default: false },
    lastSyncedAt: { type: Date, default: null },
    lastEventCreatedAt: { type: Number, default: null },
    tenantId: { type: String, index: true },
  },
  { timestamps: true },
);

surveilSubscriptionSchema.index({ userId: 1, tenantId: 1 }, { unique: true });

export default surveilSubscriptionSchema;
