import { Schema } from 'mongoose';
import type { ISurvielEvent } from '~/types';

const survielEventSchema: Schema<ISurvielEvent> = new Schema<ISurvielEvent>(
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

survielEventSchema.index({ eventId: 1 }, { unique: true });

export default survielEventSchema;
