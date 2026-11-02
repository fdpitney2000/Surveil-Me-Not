import { Model } from 'mongoose';
import type * as t from '~/types';
import { applyTenantIsolation } from '~/models/plugins/tenantIsolation';
import surveilSubscriptionSchema from '~/schema/surveilSubscription';
import surveilPeriodSchema from '~/schema/surveilPeriod';
import surveilEventSchema from '~/schema/surveilEvent';

export function createSurveilSubscriptionModel(
  mongoose: typeof import('mongoose'),
): Model<t.ISurveilSubscription> {
  applyTenantIsolation(surveilSubscriptionSchema);
  return (
    mongoose.models.SurveilSubscription ||
    mongoose.model<t.ISurveilSubscription>('SurveilSubscription', surveilSubscriptionSchema)
  );
}

export function createSurveilPeriodModel(
  mongoose: typeof import('mongoose'),
): Model<t.ISurveilPeriod> {
  applyTenantIsolation(surveilPeriodSchema);
  return (
    mongoose.models.SurveilPeriod ||
    mongoose.model<t.ISurveilPeriod>('SurveilPeriod', surveilPeriodSchema)
  );
}

export function createSurveilEventModel(
  mongoose: typeof import('mongoose'),
): Model<t.ISurveilEvent> {
  return (
    mongoose.models.SurveilEvent ||
    mongoose.model<t.ISurveilEvent>('SurveilEvent', surveilEventSchema)
  );
}
