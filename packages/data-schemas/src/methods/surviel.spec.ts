import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import survielSubscriptionSchema from '~/schema/survielSubscription';
import survielPeriodSchema from '~/schema/survielPeriod';
import survielEventSchema from '~/schema/survielEvent';
import { createSurvielMethods } from './surviel';

let server: MongoMemoryServer;
let methods: ReturnType<typeof createSurvielMethods>;

beforeAll(async () => {
  server = await MongoMemoryServer.create();
  await mongoose.connect(server.getUri());
  mongoose.model('SurvielSubscription', survielSubscriptionSchema);
  mongoose.model('SurvielPeriod', survielPeriodSchema);
  mongoose.model('SurvielEvent', survielEventSchema);
  methods = createSurvielMethods(mongoose);
});

afterAll(async () => {
  await mongoose.disconnect();
  await server.stop();
});

beforeEach(async () => {
  await mongoose.connection.db?.dropDatabase();
});

const tier = { tier1: 0, tier2: 0, tier3: 0 };

describe('Surviel period idempotency', () => {
  it('creates a period once per invoice id', async () => {
    const input = {
      userId: new mongoose.Types.ObjectId(),
      invoiceId: 'in_123',
      plan: '100',
      grantMicroUsd: 90_000_000,
      snapshotByTier: tier,
    };
    const first = await methods.createSurvielPeriod(input);
    const second = await methods.createSurvielPeriod(input);
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);

    const count = await mongoose.models.SurvielPeriod.countDocuments({ invoiceId: 'in_123' });
    expect(count).toBe(1);
  });
});

describe('Surviel event idempotency', () => {
  it('records each event id once', async () => {
    const first = await methods.recordSurvielEvent({
      eventId: 'evt_1',
      type: 'invoice.paid',
      created: 1,
    });
    const second = await methods.recordSurvielEvent({
      eventId: 'evt_1',
      type: 'invoice.paid',
      created: 1,
    });
    expect(first.duplicate).toBe(false);
    expect(second.duplicate).toBe(true);
  });
});

describe('Surviel subscription upsert', () => {
  it('upserts and resolves by user and customer', async () => {
    const userId = new mongoose.Types.ObjectId();
    await methods.upsertSurvielSubscription(
      { userId },
      { stripeCustomerId: 'cus_1', status: 'active', grantMicroUsd: 45_000_000 },
    );
    await methods.upsertSurvielSubscription({ userId }, { status: 'past_due' });

    const byUser = await methods.getSurvielSubscriptionByUser(String(userId));
    expect(byUser?.status).toBe('past_due');
    expect(byUser?.grantMicroUsd).toBe(45_000_000);

    const byCustomer = await methods.getSurvielSubscriptionByCustomer('cus_1');
    expect(String(byCustomer?.userId)).toBe(String(userId));
  });

  it('deletes subscription and periods for a user', async () => {
    const userId = new mongoose.Types.ObjectId();
    await methods.upsertSurvielSubscription({ userId }, { status: 'active' });
    await methods.createSurvielPeriod({
      userId,
      invoiceId: 'in_del',
      grantMicroUsd: 1,
      snapshotByTier: tier,
    });
    await methods.deleteSurvielForUser(String(userId));
    expect(await methods.getSurvielSubscriptionByUser(String(userId))).toBeNull();
    expect(await mongoose.models.SurvielPeriod.countDocuments({ userId })).toBe(0);
  });
});
