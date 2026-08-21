import path from 'node:path';
import { z } from 'zod';

const optionalUrl = z.string().url().or(z.literal('')).default('');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(7000),
  DATABASE_URL: z.string().default('./data/app.db'),
  PUBLIC_ADDON_URL: z.string().url().default('http://localhost:7000'),
  ADMIN_ORIGIN: optionalUrl,
  SESSION_SECRET: z.string().min(32).default('development-only-secret-change-me-now'),
  OIDC_ISSUER_URL: optionalUrl,
  OIDC_CLIENT_ID: z.string().default(''),
  OIDC_CLIENT_SECRET: z.string().default(''),
  OIDC_REDIRECT_URI: optionalUrl,
  TMDB_API_KEY: z.string().default(''),
  AI_ENABLED: z.enum(['true', 'false']).default('false').transform((value) => value === 'true'),
  OPENAI_BASE_URL: optionalUrl.default('https://api.openai.com/v1'),
  OPENAI_API_KEY: z.string().default(''),
  OPENAI_MODEL: z.string().default(''),
});

export type Config = ReturnType<typeof loadConfig>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  const value = schema.parse(env);
  const databasePath = value.DATABASE_URL === ':memory:'
    ? ':memory:'
    : path.resolve(value.DATABASE_URL.replace(/^sqlite:\/\//, ''));
  const oidcConfigured = Boolean(
    value.OIDC_ISSUER_URL && value.OIDC_CLIENT_ID && value.OIDC_CLIENT_SECRET && value.OIDC_REDIRECT_URI,
  );
  const publicUrl = new URL(value.PUBLIC_ADDON_URL);
  const isLoopback = ['localhost', '127.0.0.1', '::1'].includes(publicUrl.hostname);
  if (value.NODE_ENV === 'production' && !oidcConfigured) {
    throw new Error('OIDC configuration is required in production');
  }
  if (value.NODE_ENV === 'production' && publicUrl.protocol !== 'https:' && !isLoopback) {
    throw new Error('PUBLIC_ADDON_URL must use HTTPS in production unless it targets loopback');
  }
  const adminOrigin = value.ADMIN_ORIGIN || 'http://localhost:5173';
  return { ...value, databasePath, oidcConfigured, adminOrigin, secureCookies: publicUrl.protocol === 'https:' };
}
