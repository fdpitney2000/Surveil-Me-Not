const nodemailer = require('nodemailer');
const { readFileAsString } = require('@librechat/api');

jest.mock('nodemailer');
jest.mock('@librechat/data-schemas', () => ({
  logger: { debug: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));
jest.mock('@librechat/api', () => ({
  logAxiosError: jest.fn(),
  isEnabled: jest.fn((val) => val === 'true' || val === true),
  readFileAsString: jest.fn(),
  serviceRequestBudget: jest.fn(() => ({ timeout: 10000 })),
}));

const savedEnv = { ...process.env };

const mockSendMail = jest.fn().mockResolvedValue({ messageId: 'test-id' });

beforeEach(() => {
  jest.clearAllMocks();
  process.env = { ...savedEnv };
  process.env.EMAIL_HOST = 'smtp.example.com';
  process.env.EMAIL_PORT = '587';
  process.env.EMAIL_FROM = 'noreply@example.com';
  process.env.APP_TITLE = 'TestApp';
  delete process.env.EMAIL_USERNAME;
  delete process.env.EMAIL_PASSWORD;
  delete process.env.MAILGUN_API_KEY;
  delete process.env.MAILGUN_DOMAIN;
  delete process.env.EMAIL_SERVICE;
  delete process.env.EMAIL_ENCRYPTION;
  delete process.env.EMAIL_ENCRYPTION_HOSTNAME;
  delete process.env.EMAIL_ALLOW_SELFSIGNED;
  delete process.env.LOOPS_API_KEY;
  delete process.env.LOOPS_TRANSACTIONAL_VERIFY_ID;
  delete process.env.LOOPS_TRANSACTIONAL_RESET_ID;

  readFileAsString.mockResolvedValue({ content: '<p>{{name}}</p>' });
  nodemailer.createTransport.mockReturnValue({ sendMail: mockSendMail });
});

afterAll(() => {
  process.env = savedEnv;
});

/** Loads a fresh copy of sendEmail so process.env reads are re-evaluated. */
function loadSendEmail() {
  jest.resetModules();
  jest.mock('nodemailer', () => ({
    createTransport: jest.fn().mockReturnValue({ sendMail: mockSendMail }),
  }));
  jest.mock('@librechat/data-schemas', () => ({
    logger: { debug: jest.fn(), warn: jest.fn(), error: jest.fn() },
  }));
  jest.mock('@librechat/api', () => ({
    logAxiosError: jest.fn(),
    isEnabled: jest.fn((val) => val === 'true' || val === true),
    readFileAsString: jest.fn().mockResolvedValue({ content: '<p>{{name}}</p>' }),
    serviceRequestBudget: jest.fn(() => ({ timeout: 10000 })),
  }));
  return require('../sendEmail');
}

const baseParams = {
  email: 'user@example.com',
  subject: 'Test',
  payload: { name: 'User' },
  template: 'test.handlebars',
};

describe('sendEmail SMTP auth assembly', () => {
  it('includes auth when both EMAIL_USERNAME and EMAIL_PASSWORD are set', async () => {
    process.env.EMAIL_USERNAME = 'smtp_user';
    process.env.EMAIL_PASSWORD = 'smtp_pass';
    const sendEmail = loadSendEmail();
    const { createTransport } = require('nodemailer');

    await sendEmail(baseParams);

    expect(createTransport).toHaveBeenCalledTimes(1);
    const transporterOptions = createTransport.mock.calls[0][0];
    expect(transporterOptions.auth).toEqual({
      user: 'smtp_user',
      pass: 'smtp_pass',
    });
  });

  it('omits auth when both EMAIL_USERNAME and EMAIL_PASSWORD are absent', async () => {
    const sendEmail = loadSendEmail();
    const { createTransport } = require('nodemailer');

    await sendEmail(baseParams);

    expect(createTransport).toHaveBeenCalledTimes(1);
    const transporterOptions = createTransport.mock.calls[0][0];
    expect(transporterOptions.auth).toBeUndefined();
  });

  it('omits auth and logs a warning when only EMAIL_USERNAME is set', async () => {
    process.env.EMAIL_USERNAME = 'smtp_user';
    const sendEmail = loadSendEmail();
    const { createTransport } = require('nodemailer');
    const { logger: freshLogger } = require('@librechat/data-schemas');

    await sendEmail(baseParams);

    const transporterOptions = createTransport.mock.calls[0][0];
    expect(transporterOptions.auth).toBeUndefined();
    expect(freshLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('EMAIL_USERNAME and EMAIL_PASSWORD must both be set'),
    );
  });

  it('omits auth and logs a warning when only EMAIL_PASSWORD is set', async () => {
    process.env.EMAIL_PASSWORD = 'smtp_pass';
    const sendEmail = loadSendEmail();
    const { createTransport } = require('nodemailer');
    const { logger: freshLogger } = require('@librechat/data-schemas');

    await sendEmail(baseParams);

    const transporterOptions = createTransport.mock.calls[0][0];
    expect(transporterOptions.auth).toBeUndefined();
    expect(freshLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('EMAIL_USERNAME and EMAIL_PASSWORD must both be set'),
    );
  });

  it('does not log a warning when both credentials are properly set', async () => {
    process.env.EMAIL_USERNAME = 'smtp_user';
    process.env.EMAIL_PASSWORD = 'smtp_pass';
    const sendEmail = loadSendEmail();
    const { logger: freshLogger } = require('@librechat/data-schemas');

    await sendEmail(baseParams);

    expect(freshLogger.warn).not.toHaveBeenCalled();
  });

  it('does not log a warning when both credentials are absent', async () => {
    const sendEmail = loadSendEmail();
    const { logger: freshLogger } = require('@librechat/data-schemas');

    await sendEmail(baseParams);

    expect(freshLogger.warn).not.toHaveBeenCalled();
  });
});

describe('sendEmail Loops provider', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('sends verification email through Loops with template variables', async () => {
    process.env.LOOPS_API_KEY = 'loops_test_key';
    process.env.LOOPS_TRANSACTIONAL_VERIFY_ID = 'cll_verify';
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ success: true }),
    });

    const sendEmail = loadSendEmail();
    await sendEmail({
      email: 'user@example.com',
      subject: 'Verify your email',
      payload: {
        name: 'User',
        verificationLink: 'https://app.example.com/verify?token=abc',
        appName: 'Surveil',
        year: 2026,
      },
      template: 'verifyEmail.handlebars',
    });

    expect(global.fetch).toHaveBeenCalledWith(
      'https://app.loops.so/api/v1/transactional',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"transactionalId":"cll_verify"'),
      }),
    );
    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body.email).toBe('user@example.com');
    expect(body.dataVariables).toEqual({
      name: 'User',
      verificationLink: 'https://app.example.com/verify?token=abc',
      appName: 'Surveil',
    });
  });

  it('falls back to SMTP when no Loops template is mapped', async () => {
    process.env.LOOPS_API_KEY = 'loops_test_key';
    global.fetch = jest.fn();
    const sendEmail = loadSendEmail();
    const { createTransport } = require('nodemailer');

    await sendEmail(baseParams);

    expect(global.fetch).not.toHaveBeenCalled();
    expect(createTransport).toHaveBeenCalledTimes(1);
  });
});

describe('sendEmail SMTP encryption options', () => {
  it('requires STARTTLS when EMAIL_ENCRYPTION=starttls', async () => {
    process.env.EMAIL_ENCRYPTION = 'starttls';
    const sendEmail = loadSendEmail();
    const { createTransport } = require('nodemailer');

    await sendEmail(baseParams);

    const transporterOptions = createTransport.mock.calls[0][0];
    expect(transporterOptions).toMatchObject({ secure: false, requireTLS: true });
  });
});
