import { Request, Response } from 'express';
import { env } from './env';

// The JWT is delivered to the browser as an httpOnly cookie so that page
// JavaScript can never read it — even a successful XSS can't steal the session.
// SameSite=Strict means the browser only sends it on same-site requests, which
// blocks cross-site request forgery. Secure (prod only) keeps it HTTPS-only.
export const AUTH_COOKIE = 'tf_token';
const MAX_AGE_MS = 24 * 60 * 60 * 1000; // matches jwtExpiresIn '1d'

export function setAuthCookie(res: Response, token: string): void {
  res.cookie(AUTH_COOKIE, token, {
    httpOnly: true,
    secure: env.nodeEnv === 'production',
    sameSite: 'strict',
    path: '/',
    maxAge: MAX_AGE_MS,
  });
}

export function clearAuthCookie(res: Response): void {
  res.clearCookie(AUTH_COOKIE, {
    httpOnly: true,
    secure: env.nodeEnv === 'production',
    sameSite: 'strict',
    path: '/',
  });
}

// Reads the session token, preferring the httpOnly cookie. Falls back to an
// Authorization: Bearer header so programmatic/API clients still work.
export function readAuthToken(req: Request): string | null {
  const raw = req.headers.cookie;
  if (raw) {
    for (const part of raw.split(';')) {
      const idx = part.indexOf('=');
      if (idx === -1) continue;
      if (part.slice(0, idx).trim() === AUTH_COOKIE) {
        return decodeURIComponent(part.slice(idx + 1).trim());
      }
    }
  }
  const header = req.headers.authorization;
  if (header && header.startsWith('Bearer ')) return header.slice('Bearer '.length).trim();
  return null;
}
