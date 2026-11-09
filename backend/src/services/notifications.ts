import type { NotificationType, PrismaClient } from '../generated/prisma/client.js';
import { db } from '../lib/db.js';
import { env } from '../lib/env.js';
import { HttpError } from '../lib/errors.js';
import { sendEmail } from './mailer.js';

type Tx = Parameters<Parameters<PrismaClient['$transaction']>[0]>[0];

export interface NewNotification {
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  link?: string;
  // The same key is never sent twice, which is what makes jobs safe to re-run.
  dedupeKey: string;
  email: boolean;
}

const MAX_EMAIL_ATTEMPTS = 3;

// Safe inside a transaction: a duplicate key is skipped rather than raising an error that would abort it.
// Returns true when the notification is new.
export async function queueNotification(tx: Tx | typeof db, n: NewNotification) {
  const { email, ...data } = n;
  const { count } = await tx.notification.createMany({
    data: [{ ...data, emailStatus: email ? 'PENDING' : 'NOT_REQUESTED' }],
    skipDuplicates: true,
  });
  return count === 1;
}

// Sends emails that are waiting. Called straight after a transaction commits, and again by the job
// to pick up anything a restart or a failed attempt left behind.
export async function deliverPendingEmails(limit = 50) {
  const pending = await db.notification.findMany({
    where: { emailStatus: 'PENDING', emailAttempts: { lt: MAX_EMAIL_ATTEMPTS } },
    orderBy: { createdAt: 'asc' },
    take: limit,
    include: { user: { select: { email: true, active: true } } },
  });
  let sent = 0;
  for (const n of pending) {
    // Claim it first, so that two servers can't both send the same email.
    const { count } = await db.notification.updateMany({
      where: { id: n.id, emailStatus: 'PENDING', emailAttempts: n.emailAttempts },
      data: { emailAttempts: { increment: 1 } },
    });
    if (!count) continue;
    if (!n.user.active) {
      await db.notification.update({ where: { id: n.id }, data: { emailStatus: 'FAILED', emailError: 'Account is deactivated' } });
      continue;
    }
    const link = n.link ? `\n\nOpen: ${env.CLIENT_URL}${n.link}` : '';
    const result = await sendEmail(n.user.email, n.title, `${n.body}${link}`);
    const lastTry = n.emailAttempts + 1 >= MAX_EMAIL_ATTEMPTS;
    await db.notification.update({
      where: { id: n.id },
      data: result.status === 'FAILED'
        ? { emailStatus: lastTry ? 'FAILED' : 'PENDING', emailError: result.error }
        : { emailStatus: result.status, emailError: null },
    });
    if (result.status === 'SENT') sent++;
  }
  return sent;
}

export async function listNotifications(userId: string) {
  const [items, unread] = await Promise.all([
    db.notification.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: { id: true, type: true, title: true, body: true, link: true, readAt: true, createdAt: true },
    }),
    db.notification.count({ where: { userId, readAt: null } }),
  ]);
  return { notifications: items, unread };
}

export async function markRead(userId: string, id: string, now = new Date()) {
  const { count } = await db.notification.updateMany({ where: { id, userId }, data: { readAt: now } });
  if (!count) throw new HttpError(404, 'That notification no longer exists');
}

export async function markAllRead(userId: string, now = new Date()) {
  await db.notification.updateMany({ where: { userId, readAt: null }, data: { readAt: now } });
}
