import type { Request, Response } from 'express';

/**
 * Liveness probe for the Surviel route group. Confirms the route is wired and the
 * built package is resolvable; it deliberately exposes no configuration or secrets.
 */
export function survielHealth(_req: Request, res: Response): void {
  res.status(200).json({ status: 'ok', service: 'surviel' });
}
