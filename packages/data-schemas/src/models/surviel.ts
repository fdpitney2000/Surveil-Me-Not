import { Model } from 'mongoose';
import type * as t from '~/types';
import { applyTenantIsolation } from '~/models/plugins/tenantIsolation';
import survielSubscriptionSchema from '~/schema/survielSubscription';
import survielPeriodSchema from '~/schema/survielPeriod';
import survielEventSchema from '~/schema/survielEvent';

export function createSurvielSubscriptionModel(
  mongoose: typeof import('mongoose'),
): Model<t.ISurvielSubscription> {
  applyTenantIsolation(survielSubscriptionSchema);
  return (
    mongoose.models.SurvielSubscription ||
    mongoose.model<t.ISurvielSubscription>('SurvielSubscription', survielSubscriptionSchema)
  );
}

export function createSurvielPeriodModel(
  mongoose: typeof import('mongoose'),
): Model<t.ISurvielPeriod> {
  applyTenantIsolation(survielPeriodSchema);
  return (
    mongoose.models.SurvielPeriod ||
    mongoose.model<t.ISurvielPeriod>('SurvielPeriod', survielPeriodSchema)
  );
}

export function createSurvielEventModel(
  mongoose: typeof import('mongoose'),
): Model<t.ISurvielEvent> {
  return (
    mongoose.models.SurvielEvent ||
    mongoose.model<t.ISurvielEvent>('SurvielEvent', survielEventSchema)
  );
}
