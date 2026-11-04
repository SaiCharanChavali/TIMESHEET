// Local development database: real PostgreSQL, run from node_modules with no system install.
// Production uses DATABASE_URL and never touches this file.
import net from 'node:net';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import EmbeddedPostgres from 'embedded-postgres';

const databaseDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');
export const PG_PORT = 5433;
export const urlFor = (db: string) => `postgresql://postgres:postgres@127.0.0.1:${PG_PORT}/${db}`;

function isPortOpen(port: number) {
  return new Promise<boolean>((resolve) => {
    const socket = net.connect({ port, host: '127.0.0.1' });
    socket.once('connect', () => { socket.destroy(); resolve(true); });
    socket.once('error', () => resolve(false));
  });
}

// Starts Postgres unless it is already running. The returned function stops it only if we started it.
export async function ensureDb(databases: string[]) {
  const pg = new EmbeddedPostgres({
    databaseDir, user: 'postgres', password: 'postgres', port: PG_PORT, persistent: true,
    initdbFlags: ['--encoding=UTF8', '--locale=C'],
    postgresFlags: ['-c', 'listen_addresses=127.0.0.1'],
  });

  const alreadyRunning = await isPortOpen(PG_PORT);
  if (!alreadyRunning) {
    if (!existsSync(path.join(databaseDir, 'PG_VERSION'))) await pg.initialise();
    await pg.start();
  }

  const client = pg.getPgClient();
  await client.connect();
  for (const db of databases) {
    const { rowCount } = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [db]);
    if (!rowCount) await client.query(`CREATE DATABASE "${db}"`);
  }
  await client.end();

  return async () => { if (!alreadyRunning) await pg.stop(); };
}
