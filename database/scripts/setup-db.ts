// One-time setup: creates the local database, applies migrations and adds demo data.
import { execSync } from 'node:child_process';
import { ensureDb } from './pg.js';

const stop = await ensureDb(['timesheet']);
try {
  execSync('npx prisma migrate deploy', { stdio: 'inherit' });
  execSync('npx prisma generate', { stdio: 'inherit' });
  execSync('npm run seed', { stdio: 'inherit' });
} finally {
  await stop();
}
