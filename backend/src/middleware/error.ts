import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { HttpError } from '../lib/errors';

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ZodError) {
    return res.status(400).json({
      error: 'Validation failed',
      details: err.flatten(),
    });
  }
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.message, details: err.details });
  }
  // Prisma unique constraint
  if (err && typeof err === 'object' && (err as any).code === 'P2002') {
    return res.status(409).json({ error: 'Duplicate value violates a unique constraint' });
  }
  console.error('[unhandled error]', err);
  return res.status(500).json({ error: 'Internal server error' });
}
