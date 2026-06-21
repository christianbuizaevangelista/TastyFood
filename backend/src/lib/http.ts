import { Request, Response, NextFunction, RequestHandler } from 'express';

// Wraps an async handler so thrown/rejected errors reach the error middleware.
export const asyncHandler =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler =>
  (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
