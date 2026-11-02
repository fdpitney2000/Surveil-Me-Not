import { Schema } from 'mongoose';
import type { ISurveilPeriod, ISurveilTierUsage } from '~/types';

const tierUsageSchema = new Schema<ISurveilTierUsage>(
  {
    tier1: { type: Number, default: 0 },
    tier2: { type: Number, default: 0 },
    tier3: { type: Number, default: 0 },
  },
  { _id: false },
);

const surveilPeriodSchema: Schema<ISurveilPeriod> = new Schema<ISurveilPeriod>(
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

surveilPeriodSchema.index({ invoiceId: 1, tenantId: 1 }, { unique: true });

export default surveilPeriodSchema;
