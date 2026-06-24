import { Request, Response, NextFunction } from 'express';
import { verifyToken } from '../lib/auth';
import { unauthorized, forbidden } from '../lib/errors';
import { getDescendantOrgIds } from '../lib/scope';
import { prisma } from '../lib/prisma';

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
    // Legacy tokens (issued before staff roles existed) lack these fields —
    // treat them as the org owner so existing sessions aren't locked out.
    if (payload.isOwner === undefined) payload.isOwner = true;
    if (payload.permissions === undefined) payload.permissions = [];

    // Re-check account standing on every request so a deleted (archived) or
    // deactivated account loses access immediately, not just at next login.
    const account = await prisma.user.findUnique({
      where: { id: payload.sub },
      select: { isActive: true, org: { select: { archivedAt: true, isActive: true, status: true } } },
    });
    if (!account || !account.org) throw unauthorized('Account no longer exists');
    if (account.org.archivedAt) throw forbidden('This account has been removed');
    if (!account.isActive) throw forbidden('Your user account is deactivated');
    if (!account.org.isActive || account.org.status !== 'APPROVED') {
      throw forbidden('This account is not active');
    }

    req.auth = payload;
    req.scopeOrgIds = await getDescendantOrgIds(payload.orgId);
    next();
  } catch (err) {
    if (err && typeof err === 'object' && 'status' in err) return next(err);
    next(unauthorized('Invalid or expired token'));
  }
}
