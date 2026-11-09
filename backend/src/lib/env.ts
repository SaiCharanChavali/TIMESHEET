import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  PORT: z.coerce.number().default(4000),
  CLIENT_URL: z.url(),
  OFFICE_TIMEZONE: z.string().default('Asia/Kolkata').refine((tz) => {
    try {
      new Intl.DateTimeFormat('en', { timeZone: tz });
      return true;
    } catch {
      return false;
    }
  }, 'OFFICE_TIMEZONE must be a valid IANA timezone'),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  // Email is sent only when SMTP_HOST is set. Otherwise it is logged in development and recorded as not sent.
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().default(587),
  // "true" for port 465 (TLS from the start). Port 587 upgrades with STARTTLS instead.
  SMTP_SECURE: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().default('ShimentoX Timesheet <no-reply@localhost>'),
  // How often background jobs (such as forgotten check-out alerts) run. 0 turns them off.
  JOB_INTERVAL_SECONDS: z.coerce.number().int().min(0).default(60),
});

export const env = schema.parse(process.env);
export const isProduction = env.NODE_ENV === 'production';
