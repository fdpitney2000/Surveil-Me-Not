import type { Model, Types } from 'mongoose';
import type { ISurvielEvent, ISurvielPeriod, ISurvielSubscription } from '~/types';

export interface CreatePeriodInput {
  userId: Types.ObjectId | string;
  invoiceId: string;
  plan?: string;
  grantMicroUsd: number;
  snapshotByTier: { tier1: number; tier2: number; tier3: number };
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

export interface SurvielMethods {
  getSurvielSubscriptionByUser: (userId: string) => Promise<ISurvielSubscription | null>;
  getSurvielSubscriptionByCustomer: (customerId: string) => Promise<ISurvielSubscription | null>;
  upsertSurvielSubscription: (
    filter: Record<string, unknown>,
    update: Partial<ISurvielSubscription>,
  ) => Promise<ISurvielSubscription | null>;
  listSurvielSubscriptions: (filter?: Record<string, unknown>) => Promise<ISurvielSubscription[]>;
  createSurvielPeriod: (
    input: CreatePeriodInput,
  ) => Promise<{ period: ISurvielPeriod | null; created: boolean }>;
  findSurvielPeriodByInvoice: (invoiceId: string) => Promise<ISurvielPeriod | null>;
  recordSurvielEvent: (input: RecordEventInput) => Promise<{ duplicate: boolean }>;
  deleteSurvielForUser: (userId: string) => Promise<void>;
}

export function createSurvielMethods(mongoose: typeof import('mongoose')): SurvielMethods {
  const Subscription = () => mongoose.models.SurvielSubscription as Model<ISurvielSubscription>;
  const Period = () => mongoose.models.SurvielPeriod as Model<ISurvielPeriod>;
  const Event = () => mongoose.models.SurvielEvent as Model<ISurvielEvent>;

  async function getSurvielSubscriptionByUser(
    userId: string,
  ): Promise<ISurvielSubscription | null> {
    return await Subscription().findOne({ userId }).lean<ISurvielSubscription>();
  }

  async function getSurvielSubscriptionByCustomer(
    customerId: string,
  ): Promise<ISurvielSubscription | null> {
    return await Subscription()
      .findOne({ stripeCustomerId: customerId })
      .lean<ISurvielSubscription>();
  }

  async function upsertSurvielSubscription(
    filter: Record<string, unknown>,
    update: Partial<ISurvielSubscription>,
  ): Promise<ISurvielSubscription | null> {
    return await Subscription()
      .findOneAndUpdate(
        filter,
        { $set: update },
        { new: true, upsert: true, setDefaultsOnInsert: true },
      )
      .lean<ISurvielSubscription>();
  }

  async function listSurvielSubscriptions(
    filter: Record<string, unknown> = {},
  ): Promise<ISurvielSubscription[]> {
    return await Subscription().find(filter).lean<ISurvielSubscription[]>();
  }

  async function createSurvielPeriod(
    input: CreatePeriodInput,
  ): Promise<{ period: ISurvielPeriod | null; created: boolean }> {
    const result = await Period().findOneAndUpdate(
      { invoiceId: input.invoiceId },
      { $setOnInsert: input },
      { new: true, upsert: true, setDefaultsOnInsert: true, includeResultMetadata: true },
    );
    const created = Boolean(result.lastErrorObject?.upserted);
    return { period: result.value as ISurvielPeriod | null, created };
  }

  async function findSurvielPeriodByInvoice(invoiceId: string): Promise<ISurvielPeriod | null> {
    return await Period().findOne({ invoiceId }).lean<ISurvielPeriod>();
  }

  async function recordSurvielEvent(input: RecordEventInput): Promise<{ duplicate: boolean }> {
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

  async function deleteSurvielForUser(userId: string): Promise<void> {
    await Promise.all([Subscription().deleteOne({ userId }), Period().deleteMany({ userId })]);
  }

  return {
    getSurvielSubscriptionByUser,
    getSurvielSubscriptionByCustomer,
    upsertSurvielSubscription,
    listSurvielSubscriptions,
    createSurvielPeriod,
    findSurvielPeriodByInvoice,
    recordSurvielEvent,
    deleteSurvielForUser,
  };
}
