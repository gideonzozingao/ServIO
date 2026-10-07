import { z } from 'zod';

/**
 * Environment variables are ALWAYS strings, so numbers must be coerced and booleans parsed explicitly.
 * Do NOT use z.coerce.boolean(): Boolean("false") === true.
 * z.stringbool() (Zod 4) accepts true/false, 1/0, yes/no, on/off, y/n, enabled/disabled (case-insensitive).
 */
const EnvSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  SERVE_HTTP_PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().url(),
  AUTH_DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  BETTER_AUTH_SECRET: z.string().min(32),
  BETTER_AUTH_URL: z.string().url(),
  PIN_PEPPER: z.string().min(24),
  CORS_ORIGINS: z.string().default(''),
  TRUSTED_PROXIES: z.string().default(''),
  STAFF_SESSION_HOURS: z.coerce.number().int().min(1).max(24).default(12),
  SELF_SIGNUP_ENABLED: z.stringbool().default(false),
  APP_URL: z.string().url(),
});

export type Env = z.infer<typeof EnvSchema>;

export function validateEnv(raw: Record<string, unknown>): Env {
  const parsed = EnvSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment:\n${issues}`);
  }
  return parsed.data;
}
