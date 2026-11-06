import { Schema } from 'mongoose';
import type { ISurveilPeriod } from '~/types';

const surveilPeriodSchema: Schema<ISurveilPeriod> = new Schema<ISurveilPeriod>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    invoiceId: { type: String, required: true },
    plan: { type: String },
    grantMicroUsd: { type: Number, default: 0 },
    snapshotUsageMicro: { type: Number, default: 0 },
    periodStart: { type: Date },
    periodEnd: { type: Date },
    kind: { type: String, enum: ['cycle', 'proration'], default: 'cycle' },
    tenantId: { type: String, index: true },
  },
  { timestamps: true },
);

surveilPeriodSchema.index({ invoiceId: 1, tenantId: 1 }, { unique: true });

export default surveilPeriodSchema;
