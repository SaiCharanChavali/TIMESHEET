import { config } from 'dotenv';
import { defineConfig, env } from 'prisma/config';

// The connection details live with the backend, the only part of the app that uses them when running.
config({ path: '../backend/.env' });

export default defineConfig({
  schema: 'schema.prisma',
  migrations: { path: 'migrations', seed: 'npm run seed' },
  datasource: { url: env('DATABASE_URL') },
});
