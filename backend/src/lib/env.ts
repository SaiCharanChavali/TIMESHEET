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
});

export const env = schema.parse(process.env);
export const isProduction = env.NODE_ENV === 'production';
