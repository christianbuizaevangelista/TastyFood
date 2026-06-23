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

// Only the org owner (full control) may proceed.
export function requireOwner(req: Request, _res: Response, next: NextFunction) {
  if (!req.auth) return next(unauthorized());
  if (!req.auth.isOwner) return next(forbidden('Owner access required'));
  next();
}

// Allow if the user is the owner or has the given permission (staff access control).
export function requirePermission(key: string) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.auth) return next(unauthorized());
    if (req.auth.isOwner || (req.auth.permissions ?? []).includes(key)) return next();
    next(forbidden(`Missing permission: ${key}`));
  };
}

// Ensure an org id the request targets is within the requester's scope chain.
export function assertInScope(req: Request, orgId: string) {
  if (!req.scopeOrgIds || !req.scopeOrgIds.includes(orgId)) {
    throw forbidden('Target organization is outside your access scope');
  }
}
