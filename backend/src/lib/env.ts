import dotenv from 'dotenv';

dotenv.config();

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

const nodeEnv = process.env.NODE_ENV ?? 'development';
const isProd = nodeEnv === 'production';

// In production the JWT secret MUST be a real, strong, explicitly-set value —
// never the dev fallback, or anyone who reads this (public) repo could forge
// tokens. Fail fast at boot rather than silently signing with a known secret.
const DEV_SECRET = 'dev-secret-change-me';
const jwtSecret = process.env.JWT_SECRET ?? DEV_SECRET;
if (isProd && (jwtSecret === DEV_SECRET || jwtSecret.length < 32)) {
  throw new Error('JWT_SECRET must be set to a strong value (>=32 chars) in production');
}

export const env = {
  port: parseInt(process.env.PORT ?? '4000', 10),
  jwtSecret,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '1d',
  clientOrigin: process.env.CLIENT_ORIGIN ?? 'http://localhost:5173',
  nodeEnv,
};
