import type { Model, Types } from 'mongoose';
import type { ISurveilEvent, ISurveilPeriod, ISurveilSubscription } from '~/types';

export interface CreatePeriodInput {
  userId: Types.ObjectId | string;
  invoiceId: string;
  plan?: string;
  grantMicroUsd: number;
  snapshotUsageMicro: number;
  periodStart?: Date;
  periodEnd?: Date;
  kind?: 'cycle' | 'proration';
  tenantId?: string;
}

export interface RecordEventInput {
  eventId: string;
  type: string;
  created: number;
  status?: 'processed' | 'ignored' | 'error';
  note?: string;
}

export interface SurveilMethods {
  getSurveilSubscriptionByUser: (userId: string) => Promise<ISurveilSubscription | null>;
  getSurveilSubscriptionByCustomer: (customerId: string) => Promise<ISurveilSubscription | null>;
  upsertSurveilSubscription: (
    filter: Record<string, unknown>,
    update: Partial<ISurveilSubscription>,
  ) => Promise<ISurveilSubscription | null>;
  listSurveilSubscriptions: (filter?: Record<string, unknown>) => Promise<ISurveilSubscription[]>;
  createSurveilPeriod: (
    input: CreatePeriodInput,
  ) => Promise<{ period: ISurveilPeriod | null; created: boolean }>;
  findSurveilPeriodByInvoice: (invoiceId: string) => Promise<ISurveilPeriod | null>;
  recordSurveilEvent: (input: RecordEventInput) => Promise<{ duplicate: boolean }>;
  deleteSurveilForUser: (userId: string) => Promise<void>;
}

export function createSurveilMethods(mongoose: typeof import('mongoose')): SurveilMethods {
  const Subscription = () => mongoose.models.SurveilSubscription as Model<ISurveilSubscription>;
  const Period = () => mongoose.models.SurveilPeriod as Model<ISurveilPeriod>;
  const Event = () => mongoose.models.SurveilEvent as Model<ISurveilEvent>;

  async function getSurveilSubscriptionByUser(
    userId: string,
  ): Promise<ISurveilSubscription | null> {
    return await Subscription().findOne({ userId }).lean<ISurveilSubscription>();
  }

  async function getSurveilSubscriptionByCustomer(
    customerId: string,
  ): Promise<ISurveilSubscription | null> {
    return await Subscription()
      .findOne({ stripeCustomerId: customerId })
      .lean<ISurveilSubscription>();
  }

  async function upsertSurveilSubscription(
    filter: Record<string, unknown>,
    update: Partial<ISurveilSubscription>,
  ): Promise<ISurveilSubscription | null> {
    return await Subscription()
      .findOneAndUpdate(
        filter,
        { $set: update },
        { new: true, upsert: true, setDefaultsOnInsert: true },
      )
      .lean<ISurveilSubscription>();
  }

  async function listSurveilSubscriptions(
    filter: Record<string, unknown> = {},
  ): Promise<ISurveilSubscription[]> {
    return await Subscription().find(filter).lean<ISurveilSubscription[]>();
  }

  async function createSurveilPeriod(
    input: CreatePeriodInput,
  ): Promise<{ period: ISurveilPeriod | null; created: boolean }> {
    const result = await Period().findOneAndUpdate(
      { invoiceId: input.invoiceId },
      { $setOnInsert: input },
      { new: true, upsert: true, setDefaultsOnInsert: true, includeResultMetadata: true },
    );
    const created = Boolean(result.lastErrorObject?.upserted);
    return { period: result.value as ISurveilPeriod | null, created };
  }

  async function findSurveilPeriodByInvoice(invoiceId: string): Promise<ISurveilPeriod | null> {
    return await Period().findOne({ invoiceId }).lean<ISurveilPeriod>();
  }

  async function recordSurveilEvent(input: RecordEventInput): Promise<{ duplicate: boolean }> {
    const result = await Event().updateOne(
      { eventId: input.eventId },
      {
        $setOnInsert: {
          eventId: input.eventId,
          type: input.type,
          created: input.created,
          status: input.status ?? 'processed',
          note: input.note,
          processedAt: new Date(),
        },
      },
      { upsert: true },
    );
    return { duplicate: result.upsertedCount === 0 };
  }

  async function deleteSurveilForUser(userId: string): Promise<void> {
    await Promise.all([Subscription().deleteOne({ userId }), Period().deleteMany({ userId })]);
  }

  return {
    getSurveilSubscriptionByUser,
    getSurveilSubscriptionByCustomer,
    upsertSurveilSubscription,
    listSurveilSubscriptions,
    createSurveilPeriod,
    findSurveilPeriodByInvoice,
    recordSurveilEvent,
    deleteSurveilForUser,
  };
}
