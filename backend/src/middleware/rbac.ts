import { Request, Response, NextFunction } from 'express';
import { UserRole } from '@prisma/client';
import { forbidden, unauthorized } from '../lib/errors';

// Restrict a route to one or more roles.
export function requireRole(...roles: UserRole[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.auth) return next(unauthorized());
    if (!roles.includes(req.auth.role)) {
      return next(forbidden(`Requires role: ${roles.join(' or ')}`));
    }
    next();
  };
}

// Ensure an org id the request targets is within the requester's scope chain.
export function assertInScope(req: Request, orgId: string) {
  if (!req.scopeOrgIds || !req.scopeOrgIds.includes(orgId)) {
    throw forbidden('Target organization is outside your access scope');
  }
}
