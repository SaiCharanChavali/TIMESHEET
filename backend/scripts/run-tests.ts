// Runs the API tests in a separate database so that dev data is never touched.
import { execSync } from 'node:child_process';
import { ensureDb, urlFor } from '../../database/scripts/pg.js';

const stop = await ensureDb(['timesheet_test']);
const env = {
  ...process.env,
  NODE_ENV: 'test',
  DATABASE_URL: urlFor('timesheet_test'),
  JWT_SECRET: 'test-secret-test-secret-test-secret-test-secret',
  CLIENT_URL: 'http://localhost:5015',
};

let failed = false;
try {
  execSync('npx prisma migrate deploy', { stdio: 'inherit', env, cwd: '../database' });
  execSync('npx vitest run', { stdio: 'inherit', env });
} catch {
  failed = true;
} finally {
  await stop();
}
process.exit(failed ? 1 : 0);
