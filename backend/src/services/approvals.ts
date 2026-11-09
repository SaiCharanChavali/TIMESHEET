import { Prisma, Role, type PrismaClient, type User } from '../generated/prisma/client.js';
import { db } from '../lib/db.js';
import { env } from '../lib/env.js';
import { HttpError } from '../lib/errors.js';
import { addDays, dayToDb, dbToDay, isOvernight, officeDateTime, officeTime, weekday } from '../lib/officeTime.js';
import { getTimesheet, monthStart } from './attendance.js';
import { calcDayWithBreakMs, type DayRules } from './attendanceCalc.js';
import { resolveAlertForAttendance } from './forgottenCheckout.js';

type Tx = Parameters<Parameters<PrismaClient['$transaction']>[0]>[0];

const LOCKED = ['SUBMITTED', 'APPROVED'] as const;

// Serialises one person's requests and submissions, so that two can't slip past each other's checks.
const lockUser = (tx: Tx, userId: string) => tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;

async function assertMonthOpen(tx: Tx, userId: string, day: string) {
  const sheet = await tx.timesheet.findUnique({ where: { userId_periodStart: { userId, periodStart: monthStart(day) } } });
  if (sheet && (LOCKED as readonly string[]).includes(sheet.status)) {
    throw new HttpError(409, sheet.status === 'APPROVED'
      ? 'This month has been approved and locked. Ask an admin to reopen it.'
      : 'This month has been submitted. Withdraw it first, or wait for your manager to review it.');
  }
}

// Direct managers review their reports and admins review anyone. Nobody reviews themselves, except the
// only active admin, who otherwise could never get anything approved.
async function assertCanReview(actor: User, subject: User) {
  if (subject.id === actor.id) {
    const otherAdmins = actor.role === Role.ADMIN
      ? await db.user.count({ where: { role: Role.ADMIN, active: true, id: { not: actor.id } } })
      : 1;
    if (otherAdmins) throw new HttpError(403, 'You cannot review your own request');
    return;
  }
  if (actor.role === Role.ADMIN) return;
  if (subject.managerId !== actor.id) throw new HttpError(403, 'You can only review requests from your own team');
}

// Which people's requests this person sees waiting for them.
async function reviewScope(actor: User): Promise<Prisma.UserWhereInput> {
  if (actor.role !== Role.ADMIN) return { managerId: actor.id };
  const otherAdmins = await db.user.count({ where: { role: Role.ADMIN, active: true, id: { not: actor.id } } });
  return otherAdmins ? { id: { not: actor.id } } : {};
}

// The rules a corrected day is judged by: its existing record's, or the person's current shift if there is none.
async function rulesFor(userId: string, day: string, existing?: DayRules & { shiftName: string } | null, tx: Tx | typeof db = db) {
  if (existing) {
    const { shiftName, shiftStart, shiftEnd, graceMinutes, fullDayMinutes, halfDayMinutes, overtimeAfterMins, scheduled } = existing;
    return { shiftName, shiftStart, shiftEnd, graceMinutes, fullDayMinutes, halfDayMinutes, overtimeAfterMins, scheduled };
  }
  const user = await tx.user.findUniqueOrThrow({ where: { id: userId }, include: { shift: true } });
  if (!user.shift) throw new HttpError(409, 'This employee has no shift assigned. An admin needs to assign one first.');
  const holiday = await tx.holiday.findUnique({ where: { date: dayToDb(day) } });
  const { shift } = user;
  return {
    shiftName: shift.name,
    shiftStart: shift.startTime,
    shiftEnd: shift.endTime,
    graceMinutes: shift.graceMinutes,
    fullDayMinutes: shift.fullDayMinutes,
    halfDayMinutes: shift.halfDayMinutes,
    overtimeAfterMins: shift.overtimeAfterMins,
    scheduled: !holiday && !shift.weeklyOffDays.includes(weekday(day)),
  };
}

export interface CorrectionInput {
  date: string;
  checkIn: string;
  checkOut: string;
  breakMinutes: number;
  reason: string;
}

export async function createCorrection(user: User, input: CorrectionInput, now = new Date()) {
  const { date } = input;
  const today = officeTime(now).date;
  if (date > today) throw new HttpError(400, 'You cannot correct a future date');
  if (date < officeTime(user.createdAt).date) throw new HttpError(400, 'This date is before you joined');

  // On an overnight shift, a check-out earlier in the day than the check-in is the next morning.
  const [dayRecord, shift] = await Promise.all([
    db.attendance.findUnique({ where: { userId_date: { userId: user.id, date: dayToDb(date) } } }),
    user.shiftId ? db.shift.findUnique({ where: { id: user.shiftId } }) : null,
  ]);
  const overnight = dayRecord ? isOvernight(dayRecord.shiftStart, dayRecord.shiftEnd) : !!shift && isOvernight(shift.startTime, shift.endTime);
  const requestedCheckInAt = officeDateTime(date, input.checkIn);
  const requestedCheckOutAt = officeDateTime(overnight && input.checkOut <= input.checkIn ? addDays(date, 1) : date, input.checkOut);
  if (requestedCheckOutAt <= requestedCheckInAt) throw new HttpError(400, 'Check-out must be after check-in');
  if (requestedCheckOutAt > now) throw new HttpError(400, 'Check-out cannot be in the future');
  const lengthMinutes = (requestedCheckOutAt.getTime() - requestedCheckInAt.getTime()) / 60000;
  if (input.breakMinutes >= lengthMinutes) throw new HttpError(400, 'Breaks must be shorter than the time between check-in and check-out');

  return db.$transaction(async (tx) => {
    await lockUser(tx, user.id);
    await assertMonthOpen(tx, user.id, date);
    const dbDate = dayToDb(date);
    if (await tx.correctionRequest.findFirst({ where: { userId: user.id, date: dbDate, status: 'PENDING' } })) {
      throw new HttpError(409, 'You already have a request waiting for this date');
    }
    const record = await tx.attendance.findUnique({ where: { userId_date: { userId: user.id, date: dbDate } } });
    if (!record) await rulesFor(user.id, date, null, tx); // Refuses early if there's no shift to judge the day by.

    return tx.correctionRequest.create({
      data: {
        userId: user.id,
        date: dbDate,
        requestedCheckInAt,
        requestedCheckOutAt,
        requestedBreakMinutes: input.breakMinutes,
        reason: input.reason,
        originalCheckInAt: record?.checkInAt,
        originalCheckOutAt: record?.checkOutAt,
        originalBreakMinutes: record?.breakMinutes,
      },
    });
  });
}

const correctionInclude = {
  user: { select: { id: true, name: true, employeeCode: true } },
  reviewer: { select: { name: true } },
} satisfies Prisma.CorrectionRequestInclude;

type CorrectionRow = Prisma.CorrectionRequestGetPayload<{ include: typeof correctionInclude }>;

function serializeCorrection(c: CorrectionRow) {
  return {
    id: c.id,
    date: dbToDay(c.date),
    employee: c.user,
    status: c.status,
    reason: c.reason,
    requestedCheckInAt: c.requestedCheckInAt,
    requestedCheckOutAt: c.requestedCheckOutAt,
    requestedBreakMinutes: c.requestedBreakMinutes,
    originalCheckInAt: c.originalCheckInAt,
    originalCheckOutAt: c.originalCheckOutAt,
    originalBreakMinutes: c.originalBreakMinutes,
    reviewer: c.reviewer?.name ?? null,
    reviewedAt: c.reviewedAt,
    reviewNote: c.reviewNote,
    createdAt: c.createdAt,
  };
}

export async function myCorrections(user: User) {
  const rows = await db.correctionRequest.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: 'desc' },
    take: 100,
    include: correctionInclude,
  });
  return { timeZone: env.OFFICE_TIMEZONE, corrections: rows.map(serializeCorrection) };
}

export async function cancelCorrection(user: User, id: string) {
  const { count } = await db.correctionRequest.updateMany({ where: { id, userId: user.id, status: 'PENDING' }, data: { status: 'CANCELLED' } });
  if (!count) throw new HttpError(409, 'This request is no longer waiting, so it cannot be cancelled');
}

async function getForReview(actor: User, id: string) {
  const request = await db.correctionRequest.findUnique({ where: { id }, include: { user: true } });
  if (!request) throw new HttpError(404, 'That request no longer exists');
  await assertCanReview(actor, request.user);
  return request;
}

// The conditional update means that two reviewers acting at once can't both succeed.
async function claimPending(tx: Tx, actor: User, id: string, status: 'APPROVED' | 'REJECTED', now: Date, reviewNote?: string) {
  const { count } = await tx.correctionRequest.updateMany({
    where: { id, status: 'PENDING' },
    data: { status, reviewerId: actor.id, reviewedAt: now, reviewNote },
  });
  if (!count) throw new HttpError(409, 'This request has already been dealt with');
}

export async function approveCorrection(actor: User, id: string, now = new Date()) {
  const request = await getForReview(actor, id);
  const day = dbToDay(request.date);

  await db.$transaction(async (tx) => {
    await lockUser(tx, request.userId);
    await assertMonthOpen(tx, request.userId, day);
    await claimPending(tx, actor, id, 'APPROVED', now);

    const key = { userId_date: { userId: request.userId, date: request.date } };
    const existing = await tx.attendance.findUnique({ where: key });
    const rules = await rulesFor(request.userId, day, existing, tx);
    const result = calcDayWithBreakMs(request.requestedCheckInAt, request.requestedCheckOutAt, request.requestedBreakMinutes * 60000, rules);
    const data = { checkInAt: request.requestedCheckInAt, checkOutAt: request.requestedCheckOutAt, correctedAt: now, ...result };

    if (existing) {
      // Only the total is known after a correction, so the individual break times no longer apply.
      await tx.break.deleteMany({ where: { attendanceId: existing.id } });
      await tx.attendance.update({ where: { id: existing.id }, data });
      await resolveAlertForAttendance(tx, existing.id, now, 'CORRECTED');
    } else {
      await tx.attendance.create({ data: { ...rules, ...data, userId: request.userId, date: request.date } });
    }
  });
}

export async function rejectCorrection(actor: User, id: string, note: string, now = new Date()) {
  await getForReview(actor, id);
  await db.$transaction((tx) => claimPending(tx, actor, id, 'REJECTED', now, note));
}

export async function submitTimesheet(user: User, month: string, now = new Date()) {
  const day = `${month}-01`;
  await db.$transaction(async (tx) => {
    await lockUser(tx, user.id);
    await assertMonthOpen(tx, user.id, day);
    const sheet = await getTimesheet(user, 'month', day, now);
    if (sheet.blockers.length) throw new HttpError(409, sheet.blockers.join(' '));

    const statuses = Object.fromEntries(sheet.days.map((d) => [d.date, d.status]));
    const data = {
      status: 'SUBMITTED' as const,
      submittedAt: now,
      workedMinutes: sheet.totals.workedMinutes,
      overtimeMinutes: sheet.totals.overtimeMinutes,
      statuses,
      reviewerId: null,
      reviewedAt: null,
      reviewNote: null,
    };
    await tx.timesheet.upsert({
      where: { userId_periodStart: { userId: user.id, periodStart: monthStart(day) } },
      update: data,
      create: { ...data, userId: user.id, periodStart: monthStart(day) },
    });
  });
}

export async function withdrawTimesheet(user: User, month: string) {
  const { count } = await db.timesheet.deleteMany({ where: { userId: user.id, periodStart: monthStart(`${month}-01`), status: 'SUBMITTED' } });
  if (!count) throw new HttpError(409, 'This month is not waiting for review, so it cannot be withdrawn');
}

async function reviewTimesheet(actor: User, id: string, from: 'SUBMITTED' | 'APPROVED', status: 'APPROVED' | 'REJECTED', now: Date, reviewNote?: string) {
  const sheet = await db.timesheet.findUnique({ where: { id }, include: { user: true } });
  if (!sheet) throw new HttpError(404, 'That timesheet no longer exists');
  await assertCanReview(actor, sheet.user);
  const { count } = await db.timesheet.updateMany({
    where: { id, status: from },
    data: { status, reviewerId: actor.id, reviewedAt: now, reviewNote: reviewNote ?? null },
  });
  if (!count) throw new HttpError(409, 'This timesheet has already been dealt with');
}

export const approveTimesheet = (actor: User, id: string, now = new Date()) => reviewTimesheet(actor, id, 'SUBMITTED', 'APPROVED', now);
export const rejectTimesheet = (actor: User, id: string, note: string, now = new Date()) => reviewTimesheet(actor, id, 'SUBMITTED', 'REJECTED', now, note);
// Sends an approved month back to the employee, so that it can be corrected and submitted again.
export const reopenTimesheet = (actor: User, id: string, note: string, now = new Date()) => reviewTimesheet(actor, id, 'APPROVED', 'REJECTED', now, note);

export async function getApprovals(actor: User) {
  const where = await reviewScope(actor);
  const [corrections, timesheets] = await Promise.all([
    db.correctionRequest.findMany({
      where: { status: 'PENDING', user: where },
      orderBy: { createdAt: 'asc' },
      include: correctionInclude,
    }),
    db.timesheet.findMany({
      where: { status: 'SUBMITTED', user: where },
      orderBy: { submittedAt: 'asc' },
      include: { user: { select: { id: true, name: true, employeeCode: true } } },
    }),
  ]);

  const correctionRows = await Promise.all(corrections.map(async (c) => {
    const existing = await db.attendance.findUnique({ where: { userId_date: { userId: c.userId, date: c.date } } });
    // Shows the reviewer what approving would mean. A shift removed since the request leaves this empty.
    const rules = await rulesFor(c.userId, dbToDay(c.date), existing).catch(() => null);
    const outcome = rules && calcDayWithBreakMs(c.requestedCheckInAt, c.requestedCheckOutAt, c.requestedBreakMinutes * 60000, rules);
    return { ...serializeCorrection(c), outcome: outcome && { status: outcome.status, workedMinutes: outcome.workedMinutes } };
  }));

  return {
    timeZone: env.OFFICE_TIMEZONE,
    corrections: correctionRows,
    timesheets: timesheets.map((t) => ({
      id: t.id,
      month: dbToDay(t.periodStart).slice(0, 7),
      employee: t.user,
      submittedAt: t.submittedAt,
      workedMinutes: t.workedMinutes,
      overtimeMinutes: t.overtimeMinutes,
    })),
    count: corrections.length + timesheets.length,
  };
}
