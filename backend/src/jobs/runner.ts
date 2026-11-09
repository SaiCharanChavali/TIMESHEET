import type { Prisma } from '../generated/prisma/client.js';
import { db } from '../lib/db.js';
import { env } from '../lib/env.js';

export interface Job {
  name: string;
  // Longest a run may take before another server is allowed to assume it crashed and take over.
  leaseMinutes: number;
  run: (now: Date) => Promise<Prisma.InputJsonValue>;
}

// Runs a job unless another server already holds its lease. Safe to call as often as you like.
export async function runJob(job: Job, now = new Date()) {
  await db.jobRun.createMany({ data: [{ name: job.name }], skipDuplicates: true });
  const { count } = await db.jobRun.updateMany({
    where: { name: job.name, OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }] },
    data: { lockedUntil: new Date(now.getTime() + job.leaseMinutes * 60000), lastStartedAt: now },
  });
  if (!count) return { ran: false as const };

  try {
    const summary = await job.run(now);
    await db.jobRun.update({
      where: { name: job.name },
      data: { lockedUntil: null, lastFinishedAt: new Date(), lastError: null, lastSummary: summary },
    });
    return { ran: true as const, summary };
  } catch (err) {
    console.error(`Job ${job.name} failed:`, err);
    const message = (err as Error).message.slice(0, 1000);
    await db.jobRun.update({ where: { name: job.name }, data: { lockedUntil: null, lastFinishedAt: new Date(), lastError: message } });
    return { ran: true as const, error: message };
  }
}

export const jobStatus = (name: string) => db.jobRun.findUnique({ where: { name } });

// Runs every job now and then on a fixed interval. Nothing depends on anyone keeping a browser open,
// and because each job works from what is in the database, a restart simply carries on where it left off.
export function startScheduler(jobs: Job[]) {
  if (!env.JOB_INTERVAL_SECONDS) {
    console.log('Background jobs are turned off (JOB_INTERVAL_SECONDS=0).');
    return () => {};
  }
  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      for (const job of jobs) await runJob(job);
    } catch (err) {
      console.error('Background jobs failed:', err);
    } finally {
      busy = false;
    }
  };
  void tick();
  const timer = setInterval(tick, env.JOB_INTERVAL_SECONDS * 1000);
  return () => clearInterval(timer);
}
