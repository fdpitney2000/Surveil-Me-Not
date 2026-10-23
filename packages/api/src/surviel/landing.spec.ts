import type { NextFunction, Request, Response } from 'express';
import { createLandingHandler } from './landing';

const landingFile = '/app/client/dist/home.html';

function mockResponse(sendFile: jest.Mock): Response {
  return { sendFile } as unknown as Response;
}

describe('createLandingHandler', () => {
  it('serves the landing page to a visitor without a session', () => {
    const sendFile = jest.fn((_file: string, callback: (err?: Error) => void) => callback());
    const next = jest.fn();

    createLandingHandler({ landingFile })(
      {} as Request,
      mockResponse(sendFile),
      next as NextFunction,
    );

    expect(sendFile).toHaveBeenCalledWith(landingFile, expect.any(Function));
    expect(next).not.toHaveBeenCalled();
  });

  it('falls through to the SPA for an authenticated caller', () => {
    const sendFile = jest.fn();
    const next = jest.fn();

    createLandingHandler({ landingFile })(
      { user: { id: 'user-1' } } as unknown as Request,
      mockResponse(sendFile),
      next as NextFunction,
    );

    expect(sendFile).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('keeps the SPA fallback reachable when the landing file is absent', () => {
    const sendFile = jest.fn((_file: string, callback: (err?: Error) => void) =>
      callback(new Error('ENOENT')),
    );
    const next = jest.fn();

    createLandingHandler({ landingFile })(
      {} as Request,
      mockResponse(sendFile),
      next as NextFunction,
    );

    expect(next).toHaveBeenCalledTimes(1);
  });
});
