import { validateEnv } from './env.validation.js';

export interface AppConfig {
  port: number;
  isProd: boolean;
  databaseUrl: string;
  authDatabaseUrl: string;
  redisUrl: string;
  auth: { secret: string; baseUrl: string; pinPepper: string; staffSessionHours: number };
  corsOrigins: string[];
  appUrl: string;
  selfSignupEnabled: boolean;
  trustedProxies: string[];
}

/** ConfigModule.load factory: validated env → typed `app` namespace. Read with config.getOrThrow<AppConfig>('app'). */
export const configuration = (): { app: AppConfig } => {
  const env = validateEnv(process.env);
  return {
    app: {
      port: env.SERVE_HTTP_PORT,
      isProd: env.NODE_ENV === 'production',
      databaseUrl: env.DATABASE_URL,
      authDatabaseUrl: env.AUTH_DATABASE_URL,
      redisUrl: env.REDIS_URL,
      auth: {
        secret: env.BETTER_AUTH_SECRET,
        baseUrl: env.BETTER_AUTH_URL,
        pinPepper: env.PIN_PEPPER,
        staffSessionHours: env.STAFF_SESSION_HOURS,
      },
      appUrl: env.APP_URL.replace(/\/$/, ''),
      selfSignupEnabled: env.SELF_SIGNUP_ENABLED,
      trustedProxies: env.TRUSTED_PROXIES.split(',').map((s) => s.trim()).filter(Boolean),
      corsOrigins: env.CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean),
    },
  };
};
