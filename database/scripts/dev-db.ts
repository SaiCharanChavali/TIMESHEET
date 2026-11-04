import { ensureDb, PG_PORT } from './pg.js';

const stop = await ensureDb(['timesheet']);
console.log(`PostgreSQL ready on port ${PG_PORT}. Press Ctrl+C to stop.`);

const shutdown = async () => { await stop(); process.exit(0); };
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
setInterval(() => {}, 1 << 30);
