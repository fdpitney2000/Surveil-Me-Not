import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import surveilSubscriptionSchema from '~/schema/surveilSubscription';
import surveilPeriodSchema from '~/schema/surveilPeriod';
import surveilEventSchema from '~/schema/surveilEvent';
import { createSurveilMethods } from './surveil';

let server: MongoMemoryServer;
let methods: ReturnType<typeof createSurveilMethods>;

beforeAll(async () => {
  server = await MongoMemoryServer.create();
  await mongoose.connect(server.getUri());
  mongoose.model('SurveilSubscription', surveilSubscriptionSchema);
  mongoose.model('SurveilPeriod', surveilPeriodSchema);
  mongoose.model('SurveilEvent', surveilEventSchema);
  methods = createSurveilMethods(mongoose);
});

afterAll(async () => {
  await mongoose.disconnect();
  await server.stop();
});

beforeEach(async () => {
  await mongoose.connection.db?.dropDatabase();
});

const tier = { tier1: 0, tier2: 0, tier3: 0 };

describe('Surveil period idempotency', () => {
  it('creates a period once per invoice id', async () => {
    const input = {
      userId: new mongoose.Types.ObjectId(),
      invoiceId: 'in_123',
      plan: '100',
      grantMicroUsd: 90_000_000,
      snapshotByTier: tier,
    };
    const first = await methods.createSurveilPeriod(input);
    const second = await methods.createSurveilPeriod(input);
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);

    const count = await mongoose.models.SurveilPeriod.countDocuments({ invoiceId: 'in_123' });
    expect(count).toBe(1);
  });
});

describe('Surveil event idempotency', () => {
  it('records each event id once', async () => {
    const first = await methods.recordSurveilEvent({
      eventId: 'evt_1',
      type: 'invoice.paid',
      created: 1,
    });
    const second = await methods.recordSurveilEvent({
      eventId: 'evt_1',
      type: 'invoice.paid',
      created: 1,
    });
    expect(first.duplicate).toBe(false);
    expect(second.duplicate).toBe(true);
  });
});

describe('Surveil subscription upsert', () => {
  it('upserts and resolves by user and customer', async () => {
    const userId = new mongoose.Types.ObjectId();
    await methods.upsertSurveilSubscription(
      { userId },
      { stripeCustomerId: 'cus_1', status: 'active', grantMicroUsd: 45_000_000 },
    );
    await methods.upsertSurveilSubscription({ userId }, { status: 'past_due' });

    const byUser = await methods.getSurveilSubscriptionByUser(String(userId));
    expect(byUser?.status).toBe('past_due');
    expect(byUser?.grantMicroUsd).toBe(45_000_000);

    const byCustomer = await methods.getSurveilSubscriptionByCustomer('cus_1');
    expect(String(byCustomer?.userId)).toBe(String(userId));
  });

  it('deletes subscription and periods for a user', async () => {
    const userId = new mongoose.Types.ObjectId();
    await methods.upsertSurveilSubscription({ userId }, { status: 'active' });
    await methods.createSurveilPeriod({
      userId,
      invoiceId: 'in_del',
      grantMicroUsd: 1,
      snapshotByTier: tier,
    });
    await methods.deleteSurveilForUser(String(userId));
    expect(await methods.getSurveilSubscriptionByUser(String(userId))).toBeNull();
    expect(await mongoose.models.SurveilPeriod.countDocuments({ userId })).toBe(0);
  });
});
