import type { ForgottenCheckoutResolution, ForgottenCheckoutSettings, ForgottenCheckoutStatus, Prisma, PrismaClient, User } from '../generated/prisma/client.js';
import { canReviewPerson, hrRecipients, visibleUsersWhere } from '../lib/access.js';
import { db } from '../lib/db.js';
import { env } from '../lib/env.js';
import { HttpError } from '../lib/errors.js';
import { addDays, dayToDb, dbToDay, minutesToTime, officeTime, shiftEndAt } from '../lib/officeTime.js';
import { createCorrection } from './approvals.js';
import { deliverPendingEmails, queueNotification } from './notifications.js';

type Tx = Parameters<Parameters<PrismaClient['$transaction']>[0]>[0];

// Statuses only move forward, apart from resolving, so a late-running step can never undo a later one.
const RANK: Record<ForgottenCheckoutStatus, number> = {
  AWAITING_CHECKOUT: 0, REMINDER_SENT: 1, ESCALATED: 2, REQUIRES_HR_REVIEW: 3, RESOLVED: 4,
};
const raise = (current: ForgottenCheckoutStatus, target: ForgottenCheckoutStatus) => (RANK[target] > RANK[current] ? target : current);

// Days older than this only get alerts if one was already open. Older missing check-outs still show on timesheets.
const LOOKBACK_DAYS = 2;
const MANUAL_REMINDER_COOLDOWN_MINUTES = 10;
const MINUTE = 60000;

const clock = new Intl.DateTimeFormat('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: env.OFFICE_TIMEZONE });
const dayLabel = (day: string) =>
  new Intl.DateTimeFormat('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(dayToDb(day));

export const getSettings = (client: Tx | typeof db = db) =>
  client.forgottenCheckoutSettings.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });

export type SettingsInput = Omit<ForgottenCheckoutSettings, 'id' | 'updatedAt' | 'updatedById'>;

export function updateSettings(actor: User, input: SettingsInput) {
  const data = { ...input, updatedById: actor.id };
  return db.forgottenCheckoutSettings.upsert({ where: { id: 1 }, update: data, create: { id: 1, ...data } });
}

// Called inside the transaction that records a check-out or approves a correction.
export async function resolveAlertForAttendance(tx: Tx, attendanceId: string, now: Date, resolution: ForgottenCheckoutResolution) {
  const alert = await tx.forgottenCheckoutAlert.findUnique({ where: { attendanceId } });
  if (!alert || alert.status === 'RESOLVED') return;
  await tx.forgottenCheckoutAlert.update({ where: { id: alert.id }, data: { status: 'RESOLVED', resolution, resolvedAt: now } });
  await tx.forgottenCheckoutEvent.create({
    data: { alertId: alert.id, type: 'RESOLVED', note: resolution === 'CHECKED_OUT' ? 'Checked out' : 'Correction approved' },
  });
}

type Recipient = Pick<User, 'id'>;

// Works through one attendance day. Returns how many notifications it queued.
async function processDay(attendanceId: string, settings: ForgottenCheckoutSettings, hr: Recipient[], now: Date) {
  return db.$transaction(async (tx) => {
    // Locks the day, so that a check-out or another server can't interleave with this.
    await tx.$queryRaw`SELECT id FROM "Attendance" WHERE id = ${attendanceId} FOR UPDATE`;
    const record = await tx.attendance.findUniqueOrThrow({
      where: { id: attendanceId },
      include: { checkoutAlert: true, user: { include: { manager: true } } },
    });
    if (record.checkOutAt) return { created: false, queued: 0 };

    const day = dbToDay(record.date);
    const endAt = shiftEndAt(day, record.shiftStart, record.shiftEnd);
    const firstAt = endAt.getTime() + settings.alertAfterMinutes * MINUTE;
    if (now.getTime() < firstAt) return { created: false, queued: 0 };

    let alert = record.checkoutAlert;
    if (alert?.status === 'RESOLVED') return { created: false, queued: 0 };
    const created = !alert;
    if (!alert) {
      alert = await tx.forgottenCheckoutAlert.create({
        data: { attendanceId, userId: record.userId, date: record.date, scheduledEndAt: endAt },
      });
      await tx.forgottenCheckoutEvent.create({ data: { alertId: alert.id, type: 'CREATED' } });
    }

    const { user } = record;
    const ended = `${clock.format(endAt)} on ${dayLabel(day)}`;
    const email = settings.sendEmail;
    let queued = 0;
    let status = alert.status;
    const data: Prisma.ForgottenCheckoutAlertUpdateInput = {};
    const event = (type: Prisma.ForgottenCheckoutEventCreateManyInput['type'], note?: string) =>
      tx.forgottenCheckoutEvent.create({ data: { alertId: alert.id, type, note } });

    if (settings.notifyEmployee) {
      // After downtime, several reminders may be overdue. Only one is sent, and the count catches up.
      const elapsed = now.getTime() - firstAt;
      const due = settings.repeatReminders
        ? Math.min(settings.maxReminders, 1 + Math.floor(elapsed / (settings.reminderIntervalMinutes * MINUTE)))
        : 1;
      if (alert.alertCount < due) {
        const isNew = await queueNotification(tx, {
          userId: user.id,
          type: 'FORGOTTEN_CHECKOUT',
          title: "You haven't checked out",
          body: `Your shift (${record.shiftName}) ended at ${ended}. If you're still at work, check out now. If you've already left, tell us when you left so the day can be corrected.`,
          link: '/',
          dedupeKey: `fc:${alert.id}:employee:${due}`,
          email,
        });
        if (isNew) queued++;
        data.alertCount = due;
        data.lastAlertAt = now;
        if (due > 1) status = raise(status, 'REMINDER_SENT');
        await event('REMINDER', due === 1 ? 'First alert' : `Reminder ${due} of ${settings.maxReminders}`);
      }
    }

    const manager = user.manager?.active ? user.manager : null;
    if (settings.notifyManager && manager && !alert.managerNotifiedAt && now.getTime() >= endAt.getTime() + settings.managerAfterMinutes * MINUTE) {
      if (await queueNotification(tx, {
        userId: manager.id,
        type: 'FORGOTTEN_CHECKOUT_ESCALATION',
        title: `${user.name} hasn't checked out`,
        body: `${user.name} (${user.employeeCode}) hasn't checked out of their shift (${record.shiftName}), which ended at ${ended}.`,
        link: '/checkouts',
        dedupeKey: `fc:${alert.id}:manager`,
        email,
      })) queued++;
      data.managerNotifiedAt = now;
      status = raise(status, 'ESCALATED');
      await event('MANAGER_NOTIFIED', `Notified ${manager.name}`);
    }

    if (settings.notifyHr && !alert.hrNotifiedAt && now.getTime() >= endAt.getTime() + settings.hrAfterMinutes * MINUTE) {
      for (const r of hr.filter((r) => r.id !== user.id)) {
        if (await queueNotification(tx, {
          userId: r.id,
          type: 'FORGOTTEN_CHECKOUT_ESCALATION',
          title: `Check-out needs HR review: ${user.name}`,
          body: `${user.name} (${user.employeeCode}) still hasn't checked out of their shift (${record.shiftName}), which ended at ${ended}.`,
          link: '/checkouts',
          dedupeKey: `fc:${alert.id}:hr:${r.id}`,
          email,
        })) queued++;
      }
      data.hrNotifiedAt = now;
      status = raise(status, 'REQUIRES_HR_REVIEW');
      await event('HR_NOTIFIED');
    }

    if (status !== alert.status) data.status = status;
    if (Object.keys(data).length) await tx.forgottenCheckoutAlert.update({ where: { id: alert.id }, data });
    return { created, queued };
  });
}

export async function runForgottenCheckoutJob(now = new Date()) {
  const summary = { checked: 0, alertsCreated: 0, notificationsQueued: 0, resolved: 0, failed: 0, emailsSent: 0 };

  // A safety net for days that got a check-out some other way.
  const stale = await db.forgottenCheckoutAlert.findMany({
    where: { status: { not: 'RESOLVED' }, attendance: { checkOutAt: { not: null } } },
    select: { attendanceId: true, attendance: { select: { correctedAt: true } } },
  });
  for (const s of stale) {
    await db.$transaction((tx) => resolveAlertForAttendance(tx, s.attendanceId, now, s.attendance.correctedAt ? 'CORRECTED' : 'CHECKED_OUT'));
    summary.resolved++;
  }

  const settings = await getSettings();
  if (settings.enabled) {
    const since = dayToDb(addDays(officeTime(now).date, -LOOKBACK_DAYS));
    const open = await db.attendance.findMany({
      where: {
        checkOutAt: null,
        user: { active: true },
        OR: [{ date: { gte: since } }, { checkoutAlert: { status: { not: 'RESOLVED' } } }],
      },
      select: { id: true },
      orderBy: { date: 'asc' },
    });
    const hr = await hrRecipients();
    for (const { id } of open) {
      summary.checked++;
      // One person's problem must not stop everyone else's alerts.
      try {
        const result = await processDay(id, settings, hr, now);
        if (result.created) summary.alertsCreated++;
        summary.notificationsQueued += result.queued;
      } catch (err) {
        summary.failed++;
        console.error(`Forgotten check-out alert failed for attendance ${id}:`, err);
      }
    }
  }

  summary.emailsSent = await deliverPendingEmails();
  return summary;
}

const alertInclude = {
  user: { select: { id: true, name: true, employeeCode: true, managerId: true, department: { select: { name: true } } } },
  attendance: { select: { checkInAt: true, checkOutAt: true, shiftName: true, shiftStart: true, shiftEnd: true } },
  events: { orderBy: { createdAt: 'asc' }, include: { actor: { select: { name: true } } } },
} satisfies Prisma.ForgottenCheckoutAlertInclude;

type AlertRow = Prisma.ForgottenCheckoutAlertGetPayload<{ include: typeof alertInclude }>;

function serialize(a: AlertRow, now: Date) {
  const until = a.resolvedAt ?? a.attendance.checkOutAt ?? now;
  return {
    id: a.id,
    date: dbToDay(a.date),
    employee: { id: a.user.id, name: a.user.name, employeeCode: a.user.employeeCode, department: a.user.department?.name ?? null },
    shift: { name: a.attendance.shiftName, startTime: a.attendance.shiftStart, endTime: a.attendance.shiftEnd },
    scheduledEndAt: a.scheduledEndAt,
    checkInAt: a.attendance.checkInAt,
    checkOutAt: a.attendance.checkOutAt,
    missingMinutes: Math.max(0, Math.floor((until.getTime() - a.scheduledEndAt.getTime()) / MINUTE)),
    status: a.status,
    alertCount: a.alertCount,
    lastAlertAt: a.lastAlertAt,
    explanation: a.explanation,
    explainedAt: a.explainedAt,
    resolution: a.resolution,
    resolvedAt: a.resolvedAt,
    events: a.events.map((e) => ({ type: e.type, actor: e.actor?.name ?? null, note: e.note, at: e.createdAt })),
  };
}

export interface ListFilters {
  status: 'open' | 'resolved' | 'all';
  from?: string;
  to?: string;
}

export async function listAlerts(actor: User, filters: ListFilters, now = new Date()) {
  const statusWhere: Prisma.ForgottenCheckoutAlertWhereInput =
    filters.status === 'open' ? { status: { not: 'RESOLVED' } } : filters.status === 'resolved' ? { status: 'RESOLVED' } : {};
  const rows = await db.forgottenCheckoutAlert.findMany({
    where: {
      ...statusWhere,
      user: visibleUsersWhere(actor),
      date: { ...(filters.from ? { gte: dayToDb(filters.from) } : {}), ...(filters.to ? { lte: dayToDb(filters.to) } : {}) },
    },
    orderBy: [{ scheduledEndAt: 'desc' }],
    take: 500,
    include: alertInclude,
  });
  return {
    timeZone: env.OFFICE_TIMEZONE,
    alerts: rows.map((a) => ({ ...serialize(a, now), canAct: a.status !== 'RESOLVED' && canReviewPerson(actor, a.user) })),
  };
}

export async function myAlerts(user: User, now = new Date()) {
  const rows = await db.forgottenCheckoutAlert.findMany({
    where: { userId: user.id },
    orderBy: { scheduledEndAt: 'desc' },
    take: 100,
    include: alertInclude,
  });
  return {
    timeZone: env.OFFICE_TIMEZONE,
    alerts: rows.map((a) => ({ ...serialize(a, now), canExplain: a.status !== 'RESOLVED' && !a.explanation })),
  };
}

async function loadForReview(actor: User, id: string) {
  const alert = await db.forgottenCheckoutAlert.findUnique({ where: { id }, include: { user: true } });
  if (!alert) throw new HttpError(404, 'That alert no longer exists');
  if (!canReviewPerson(actor, alert.user)) throw new HttpError(403, 'You can only act on alerts for your own team');
  if (alert.status === 'RESOLVED') throw new HttpError(409, 'This alert has already been resolved');
  return alert;
}

// Locks the alert and re-checks it, so that two reviewers acting at once can't both succeed.
async function withOpenAlert<T>(id: string, action: (tx: Tx, alert: NonNullable<Awaited<ReturnType<typeof lockedAlert>>>) => Promise<T>) {
  const result = await db.$transaction(async (tx) => {
    const alert = await lockedAlert(tx, id);
    if (!alert || alert.status === 'RESOLVED') throw new HttpError(409, 'This alert has already been resolved');
    return action(tx, alert);
  });
  await deliverPendingEmails();
  return result;
}

async function lockedAlert(tx: Tx, id: string) {
  await tx.$queryRaw`SELECT id FROM "ForgottenCheckoutAlert" WHERE id = ${id} FOR UPDATE`;
  return tx.forgottenCheckoutAlert.findUnique({ where: { id }, include: { user: true, attendance: true } });
}

export async function sendReminder(actor: User, id: string, now = new Date()) {
  await loadForReview(actor, id);
  const settings = await getSettings();
  await withOpenAlert(id, async (tx, alert) => {
    if (alert.attendance.checkOutAt) throw new HttpError(409, 'This person has already checked out');
    if (alert.lastAlertAt) {
      const wait = MANUAL_REMINDER_COOLDOWN_MINUTES - Math.floor((now.getTime() - alert.lastAlertAt.getTime()) / MINUTE);
      if (wait > 0) throw new HttpError(409, `A reminder was sent recently. You can send another in ${wait} minute${wait === 1 ? '' : 's'}.`);
    }
    await queueNotification(tx, {
      userId: alert.userId,
      type: 'FORGOTTEN_CHECKOUT',
      title: 'Reminder: please check out',
      body: `${actor.name} reminded you that you haven't checked out of your shift (${alert.attendance.shiftName}) on ${dayLabel(dbToDay(alert.date))}. If you've already left, tell us when you left.`,
      link: '/',
      dedupeKey: `fc:${alert.id}:manual:${now.getTime()}`,
      email: settings.sendEmail,
    });
    await tx.forgottenCheckoutAlert.update({
      where: { id },
      data: { alertCount: { increment: 1 }, lastAlertAt: now, status: raise(alert.status, 'REMINDER_SENT') },
    });
    await tx.forgottenCheckoutEvent.create({ data: { alertId: id, type: 'MANUAL_REMINDER', actorId: actor.id } });
  });
}

export async function escalateToHr(actor: User, id: string, note: string, now = new Date()) {
  await loadForReview(actor, id);
  const [settings, hr] = await Promise.all([getSettings(), hrRecipients()]);
  await withOpenAlert(id, async (tx, alert) => {
    if (alert.status === 'REQUIRES_HR_REVIEW') throw new HttpError(409, 'This alert is already with HR');
    for (const r of hr.filter((r) => r.id !== actor.id && r.id !== alert.userId)) {
      await queueNotification(tx, {
        userId: r.id,
        type: 'FORGOTTEN_CHECKOUT_ESCALATION',
        title: `Check-out escalated to HR: ${alert.user.name}`,
        body: `${actor.name} escalated ${alert.user.name}'s missing check-out on ${dayLabel(dbToDay(alert.date))}: ${note}`,
        link: '/checkouts',
        dedupeKey: `fc:${alert.id}:escalation:${r.id}`,
        email: settings.sendEmail,
      });
    }
    await tx.forgottenCheckoutAlert.update({ where: { id }, data: { status: 'REQUIRES_HR_REVIEW', hrNotifiedAt: alert.hrNotifiedAt ?? now } });
    await tx.forgottenCheckoutEvent.create({ data: { alertId: id, type: 'ESCALATED_TO_HR', actorId: actor.id, note } });
  });
}

export async function closeAlert(actor: User, id: string, note: string, now = new Date()) {
  await loadForReview(actor, id);
  await withOpenAlert(id, async (tx) => {
    await tx.forgottenCheckoutAlert.update({ where: { id }, data: { status: 'RESOLVED', resolution: 'CLOSED', resolvedAt: now } });
    await tx.forgottenCheckoutEvent.create({ data: { alertId: id, type: 'RESOLVED', actorId: actor.id, note } });
  });
}

export interface ExplanationInput {
  explanation: string;
  // "HH:mm" at the office. When given, a correction request is raised for the manager to approve.
  leftAt?: string;
}

export async function submitExplanation(user: User, id: string, input: ExplanationInput, now = new Date()) {
  const alert = await db.forgottenCheckoutAlert.findFirst({
    where: { id, userId: user.id },
    include: { attendance: { include: { breaks: true } } },
  });
  if (!alert) throw new HttpError(404, 'That alert no longer exists');
  if (alert.status === 'RESOLVED') throw new HttpError(409, 'This alert has already been resolved');
  if (alert.explanation) throw new HttpError(409, 'You have already explained this one');

  if (input.leftAt) {
    // Reuses the normal correction flow, so the manager approves the real leaving time as usual.
    const record = alert.attendance;
    const breakMs = record.breaks.reduce((sum, b) => sum + (b.endAt ? b.endAt.getTime() - b.startAt.getTime() : 0), 0);
    await createCorrection(user, {
      date: dbToDay(alert.date),
      checkIn: minutesToTime(officeTime(record.checkInAt).minutes),
      checkOut: input.leftAt,
      breakMinutes: Math.floor(breakMs / MINUTE),
      reason: `Forgot to check out: ${input.explanation}`,
    }, now);
  }

  const settings = await getSettings();
  const fresh = await db.user.findUniqueOrThrow({ where: { id: user.id }, include: { manager: true } });
  const reviewers: Recipient[] = fresh.manager?.active ? [fresh.manager] : await hrRecipients();
  await withOpenAlert(id, async (tx, locked) => {
    if (locked.explanation) throw new HttpError(409, 'You have already explained this one');
    await tx.forgottenCheckoutAlert.update({ where: { id }, data: { explanation: input.explanation, explainedAt: now } });
    await tx.forgottenCheckoutEvent.create({ data: { alertId: id, type: 'EXPLANATION', actorId: user.id, note: input.leftAt ? `Left at ${input.leftAt}` : null } });
    for (const r of reviewers.filter((r) => r.id !== user.id)) {
      await queueNotification(tx, {
        userId: r.id,
        type: 'FORGOTTEN_CHECKOUT_EXPLANATION',
        title: `${user.name} explained a missing check-out`,
        body: `${user.name} on ${dayLabel(dbToDay(alert.date))}: ${input.explanation}${input.leftAt ? ` A correction request for leaving at ${input.leftAt} is waiting for approval.` : ''}`,
        link: input.leftAt ? '/approvals' : '/checkouts',
        dedupeKey: `fc:${alert.id}:explanation:${r.id}`,
        email: settings.sendEmail,
      });
    }
  });
}
