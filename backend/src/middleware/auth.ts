import { Request, Response, NextFunction } from 'express';
import { verifyToken } from '../lib/auth';
import { unauthorized } from '../lib/errors';
import { getDescendantOrgIds } from '../lib/scope';

// Authenticates the request from a Bearer token and attaches req.auth +
// req.scopeOrgIds (the org chain this requester may access).
export async function authenticate(req: Request, _res: Response, next: NextFunction) {
  try {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      throw unauthorized('Missing bearer token');
    }
    const token = header.slice('Bearer '.length).trim();
    const payload = verifyToken(token);
    req.auth = payload;
    req.scopeOrgIds = await getDescendantOrgIds(payload.orgId);
    next();
  } catch (err) {
    if (err && typeof err === 'object' && 'status' in err) return next(err);
    next(unauthorized('Invalid or expired token'));
  }
}
