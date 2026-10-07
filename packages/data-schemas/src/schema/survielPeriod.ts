import { Schema } from 'mongoose';
import type { ISurvielPeriod, ISurvielTierUsage } from '~/types';

const tierUsageSchema = new Schema<ISurvielTierUsage>(
  {
    tier1: { type: Number, default: 0 },
    tier2: { type: Number, default: 0 },
    tier3: { type: Number, default: 0 },
  },
  { _id: false },
);

const survielPeriodSchema: Schema<ISurvielPeriod> = new Schema<ISurvielPeriod>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    invoiceId: { type: String, required: true },
    plan: { type: String },
    grantMicroUsd: { type: Number, default: 0 },
    snapshotByTier: { type: tierUsageSchema, default: () => ({ tier1: 0, tier2: 0, tier3: 0 }) },
    periodStart: { type: Date },
    periodEnd: { type: Date },
    kind: { type: String, enum: ['cycle', 'proration'], default: 'cycle' },
    tenantId: { type: String, index: true },
  },
  { timestamps: true },
);

survielPeriodSchema.index({ invoiceId: 1, tenantId: 1 }, { unique: true });

export default survielPeriodSchema;
