import { JwtPayload } from '../lib/auth';

declare global {
  namespace Express {
    interface Request {
      auth?: JwtPayload;
      // Org ids the current requester is scoped to (self + descendants).
      scopeOrgIds?: string[];
    }
  }
}

export {};
