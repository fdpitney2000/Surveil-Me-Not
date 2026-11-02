import type { NextFunction, Request, Response } from 'express';

/** `optionalJwtAuth` runs ahead of this handler on the root route and sets `user` when a session is valid. */
type MaybeAuthenticatedRequest = Request & { user?: unknown };

export interface LandingHandlerOptions {
  /** Absolute path to the standalone landing page emitted beside the SPA shell. */
  landingFile: string;
}

/**
 * Serves the standalone landing page at the app root for visitors without a session.
 * An authenticated caller falls through so `/` keeps resolving to the app, and a build
 * that predates the page falls back to the SPA shell instead of failing the request.
 */
export function createLandingHandler({ landingFile }: LandingHandlerOptions) {
  return (req: MaybeAuthenticatedRequest, res: Response, next: NextFunction): void => {
    if (req.user != null) {
      next();
      return;
    }
    res.sendFile(landingFile, (err) => {
      if (err) {
        next();
      }
    });
  };
}
