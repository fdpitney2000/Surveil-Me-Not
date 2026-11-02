import { Schema } from 'mongoose';
import type { ISurveilEvent } from '~/types';

const surveilEventSchema: Schema<ISurveilEvent> = new Schema<ISurveilEvent>(
  {
    eventId: { type: String, required: true },
    type: { type: String, required: true },
    created: { type: Number, required: true },
    processedAt: { type: Date, default: Date.now },
    status: { type: String, enum: ['processed', 'ignored', 'error'], default: 'processed' },
    note: { type: String },
  },
  { timestamps: true },
);

surveilEventSchema.index({ eventId: 1 }, { unique: true });

export default surveilEventSchema;
