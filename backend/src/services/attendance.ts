import { Prisma, Role, type Attendance, type Break, type PrismaClient, type User } from '../generated/prisma/client.js';
import { db } from '../lib/db.js';
import { env } from '../lib/env.js';
import { HttpError } from '../lib/errors.js';
import { addDays, dayToDb, dbToDay, isOvernight, officeDateTime, officeTime, shiftEndAt, timeToMinutes, weekday } from '../lib/officeTime.js';
import { calcDay, calcLateMinutes } from './attendanceCalc.js';
import { resolveAlertForAttendance } from './forgottenCheckout.js';

type Tx = Parameters<Parameters<PrismaClient['$transaction']>[0]>[0];
type RecordWithBreaks = Attendance & { breaks: Break[] };

function serialize(record: RecordWithBreaks) {
  const { id, checkInAt, checkOutAt, shiftName, shiftStart, shiftEnd, scheduled, lateMinutes, workedMinutes, breakMinutes, earlyLeaveMinutes, overtimeMinutes, status, correctedAt } = record;
  return {
    id, checkInAt, checkOutAt, shiftName, shiftStart, shiftEnd, scheduled, lateMinutes, workedMinutes, breakMinutes, earlyLeaveMinutes, overtimeMinutes, status, correctedAt,
    date: dbToDay(record.date),
    breaks: [...record.breaks]
      .sort((a, b) => a.startAt.getTime() - b.startAt.getTime())
      .map(({ startAt, endAt }) => ({ startAt, endAt })),
  };
}

async function shiftFor(user: User) {
  return user.shiftId ? db.shift.findUnique({ where: { id: user.shiftId } }) : null;
}

const overnightRecord = (record: { shiftStart: string; shiftEnd: string }) => isOvernight(record.shiftStart, record.shiftEnd);

// The record someone is working on now: today's, or last night's if an overnight shift is still open.
async function activeRecord(client: Tx | typeof db, userId: string, now: Date) {
  const today = officeTime(now).date;
  const todays = await client.attendance.findUnique({ where: { userId_date: { userId, date: dayToDb(today) } } });
  if (todays) return todays;
  const last = await client.attendance.findUnique({ where: { userId_date: { userId, date: dayToDb(addDays(today, -1)) } } });
  return last && !last.checkOutAt && overnightRecord(last) ? last : null;
}

// What the Home page shows. After a night shift ends, it keeps showing that shift until halfway to the
// next one, so that someone who has just checked out isn't immediately offered a fresh check-in.
async function displayedRecord(userId: string, now: Date) {
  const active = await activeRecord(db, userId, now);
  if (active) return active;
  const today = officeTime(now).date;
  const yesterday = addDays(today, -1);
  const last = await db.attendance.findUnique({ where: { userId_date: { userId, date: dayToDb(yesterday) } } });
  if (!last || !overnightRecord(last)) return null;
  const endedAt = shiftEndAt(yesterday, last.shiftStart, last.shiftEnd).getTime();
  const nextStartAt = officeDateTime(today, last.shiftStart).getTime();
  return now.getTime() < (endedAt + nextStartAt) / 2 ? last : null;
}

export async function getToday(user: User, now = new Date()) {
  const { date } = officeTime(now);
  const active = await displayedRecord(user.id, now);
  const [shift, holiday, record, missed] = await Promise.all([
    shiftFor(user),
    db.holiday.findUnique({ where: { date: dayToDb(date) } }),
    active ? db.attendance.findUnique({ where: { id: active.id }, include: { breaks: true } }) : null,
    db.attendance.findFirst({
      where: { userId: user.id, checkOutAt: null, date: { lt: dayToDb(date) }, ...(active ? { id: { not: active.id } } : {}) },
      orderBy: { date: 'desc' },
    }),
  ]);
  return {
    now,
    timeZone: env.OFFICE_TIMEZONE,
    date,
    shift: shift && { name: shift.name, startTime: shift.startTime, endTime: shift.endTime },
    holiday: holiday?.name ?? null,
    weeklyOff: !!shift?.weeklyOffDays.includes(weekday(date)),
    record: record && serialize(record),
    missedCheckOutDate: missed ? dbToDay(missed.date) : null,
  };
}

export async function checkIn(user: User, now = new Date()) {
  const shift = await shiftFor(user);
  if (!shift) throw new HttpError(409, 'You have no shift assigned yet. Please ask your admin to assign one.');

  const office = officeTime(now);
  // Arriving after midnight on an overnight shift belongs to the shift that started the evening before.
  const date = isOvernight(shift.startTime, shift.endTime) && office.minutes < timeToMinutes(shift.endTime)
    ? addDays(office.date, -1)
    : office.date;
  const holiday = await db.holiday.findUnique({ where: { date: dayToDb(date) } });
  const rules = {
    shiftStart: shift.startTime,
    shiftEnd: shift.endTime,
    graceMinutes: shift.graceMinutes,
    fullDayMinutes: shift.fullDayMinutes,
    halfDayMinutes: shift.halfDayMinutes,
    overtimeAfterMins: shift.overtimeAfterMins,
    scheduled: !holiday && !shift.weeklyOffDays.includes(weekday(date)),
  };

  try {
    // The time always comes from the server, so employees can't choose their own.
    await db.attendance.create({
      data: { ...rules, userId: user.id, date: dayToDb(date), checkInAt: now, shiftName: shift.name, lateMinutes: calcLateMinutes(now, rules) },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new HttpError(409, 'You have already checked in today');
    }
    throw err;
  }
}

// Locks the current record, so that a double-click or a second tab can't apply the same action twice.
function withTodayRecord(user: User, now: Date, action: (tx: Tx, record: RecordWithBreaks) => Promise<void>) {
  return db.$transaction(async (tx) => {
    const existing = await activeRecord(tx, user.id, now);
    if (!existing) throw new HttpError(409, 'You have not checked in today');

    await tx.$queryRaw`SELECT id FROM "Attendance" WHERE id = ${existing.id} FOR UPDATE`;
    const record = await tx.attendance.findUniqueOrThrow({ where: { id: existing.id }, include: { breaks: true } });
    if (record.checkOutAt) throw new HttpError(409, 'You have already checked out today');
    await action(tx, record);
  });
}

export function startBreak(user: User, now = new Date()) {
  return withTodayRecord(user, now, async (tx, record) => {
    if (record.breaks.some((b) => !b.endAt)) throw new HttpError(409, 'You are already on a break');
    await tx.break.create({ data: { attendanceId: record.id, startAt: now } });
  });
}

export function endBreak(user: User, now = new Date()) {
  return withTodayRecord(user, now, async (tx, record) => {
    const open = record.breaks.find((b) => !b.endAt);
    if (!open) throw new HttpError(409, 'You are not on a break');
    await tx.break.update({ where: { id: open.id }, data: { endAt: now } });
  });
}

export function checkOut(user: User, now = new Date()) {
  return withTodayRecord(user, now, async (tx, record) => {
    // Checking out during a break ends that break.
    await tx.break.updateMany({ where: { attendanceId: record.id, endAt: null }, data: { endAt: now } });
    const breaks = record.breaks.map((b) => ({ startAt: b.startAt, endAt: b.endAt ?? now }));
    await tx.attendance.update({
      where: { id: record.id },
      data: { checkOutAt: now, ...calcDay(record.checkInAt, now, breaks, record) },
    });
    await resolveAlertForAttendance(tx, record.id, now, 'CHECKED_OUT');
  });
}

// Absences are worked out here rather than stored, so that adding a holiday afterwards corrects past days.
function dayStatus(day: string, today: string, record: RecordWithBreaks | undefined, holiday: string | null, weeklyOffDays: number[] | null) {
  if (record) {
    if (record.status) return record.status;
    // An overnight shift that started yesterday evening is still under way this morning.
    const ongoing = day === today || (day === addDays(today, -1) && overnightRecord(record));
    if (!ongoing) return 'MISSING_CHECK_OUT';
    return record.breaks.some((b) => !b.endAt) ? 'ON_BREAK' : 'IN_PROGRESS';
  }
  if (holiday) return 'HOLIDAY';
  if (!weeklyOffDays) return 'NO_SHIFT';
  if (weeklyOffDays.includes(weekday(day))) return 'WEEKLY_OFF';
  return day === today ? 'NOT_CHECKED_IN' : 'ABSENT';
}

// Every day in the range, newest first, limited to days from joining until today.
async function getDays(user: User, requestedFrom: string, requestedTo: string, now: Date) {
  const today = officeTime(now).date;
  const joined = officeTime(user.createdAt).date;
  const from = requestedFrom > joined ? requestedFrom : joined;
  const to = requestedTo < today ? requestedTo : today;
  const range = { gte: dayToDb(from), lte: dayToDb(to) };

  const [shift, records, holidays] = await Promise.all([
    shiftFor(user),
    db.attendance.findMany({ where: { userId: user.id, date: range }, include: { breaks: true } }),
    db.holiday.findMany({ where: { date: range } }),
  ]);
  const recordByDay = new Map(records.map((r) => [dbToDay(r.date), r]));
  const holidayByDay = new Map(holidays.map((h) => [dbToDay(h.date), h.name]));

  const result = [];
  for (let day = to; day >= from; day = addDays(day, -1)) {
    const record = recordByDay.get(day);
    const holiday = holidayByDay.get(day) ?? null;
    const status = dayStatus(day, today, record, holiday, shift?.weeklyOffDays ?? null);
    result.push({ date: day, status, holiday, record: record ? serialize(record) : null });
  }
  return result;
}

export async function getRecentDays(user: User, days: number, now = new Date()) {
  const today = officeTime(now).date;
  return { timeZone: env.OFFICE_TIMEZONE, days: await getDays(user, addDays(today, -(days - 1)), today, now) };
}

export type TimesheetView = 'day' | 'week' | 'month';

function periodFor(view: TimesheetView, anchor: string) {
  if (view === 'day') return { from: anchor, to: anchor };
  if (view === 'week') {
    // Weeks run Monday to Sunday.
    const from = addDays(anchor, -((weekday(anchor) + 6) % 7));
    return { from, to: addDays(from, 6) };
  }
  const from = `${anchor.slice(0, 8)}01`;
  // Day 28 plus 4 always lands in the next month, whatever this month's length.
  const nextMonth = `${addDays(`${anchor.slice(0, 8)}28`, 4).slice(0, 8)}01`;
  return { from, to: addDays(nextMonth, -1) };
}

// Admins can view anyone and managers their direct reports. Everyone else sees only themselves.
export async function resolveViewableUser(actor: User, userId?: string) {
  if (!userId || userId === actor.id) return actor;
  const forbidden = new HttpError(403, "You can only view your own or your team's attendance");
  if (actor.role === Role.EMPLOYEE) throw forbidden;
  if (actor.role === Role.ADMIN) {
    const user = await db.user.findUnique({ where: { id: userId } });
    if (!user) throw new HttpError(404, 'Employee not found');
    return user;
  }
  // A manager gets the same answer whether the person doesn't exist or isn't on their team.
  const report = await db.user.findFirst({ where: { id: userId, managerId: actor.id } });
  if (!report) throw forbidden;
  return report;
}

export const monthStart = (day: string) => dayToDb(`${day.slice(0, 7)}-01`);

const lockedStatuses = (sheet: { status: string; statuses: unknown }) =>
  sheet.status === 'REJECTED' ? null : (sheet.statuses as Record<string, string>);

export async function getTimesheet(user: User, view: TimesheetView, anchor?: string, now = new Date()) {
  const today = officeTime(now).date;
  const period = periodFor(view, anchor ?? today);
  const range = { gte: dayToDb(period.from), lte: dayToDb(period.to) };

  const [rawDays, sheets, pending, shift] = await Promise.all([
    getDays(user, period.from, period.to, now),
    db.timesheet.findMany({
      where: { userId: user.id, periodStart: { gte: monthStart(period.from), lte: monthStart(period.to) } },
      include: { reviewer: { select: { name: true } } },
    }),
    db.correctionRequest.findMany({ where: { userId: user.id, status: 'PENDING', date: range }, select: { date: true } }),
    shiftFor(user),
  ]);

  const sheetByMonth = new Map(sheets.map((s) => [dbToDay(s.periodStart).slice(0, 7), s]));
  const pendingDays = new Set(pending.map((p) => dbToDay(p.date)));
  const days = rawDays.reverse().map((d) => {
    const sheet = sheetByMonth.get(d.date.slice(0, 7));
    // A locked month keeps the statuses it was submitted with, whatever has changed since.
    const frozen = sheet && lockedStatuses(sheet);
    return { ...d, status: frozen?.[d.date] ?? d.status, locked: !!frozen, pendingCorrection: pendingDays.has(d.date) };
  });

  const count = (...statuses: string[]) => days.filter((d) => statuses.includes(d.status)).length;
  const sum = (pick: (r: NonNullable<(typeof days)[number]['record']>) => number | null) =>
    days.reduce((total, d) => total + (d.record ? pick(d.record) ?? 0 : 0), 0);

  const missingCheckOut = count('MISSING_CHECK_OUT');
  const sheet = view === 'month' ? sheetByMonth.get(period.from.slice(0, 7)) : undefined;
  const blockers: string[] = [];
  if (view === 'month') {
    if (period.to >= today) blockers.push('You can submit this month once it has ended.');
    if (!days.length) blockers.push('There is nothing to submit for this month.');
    if (missingCheckOut) blockers.push(`${missingCheckOut} day(s) have no check-out and need correcting.`);
    if (pendingDays.size) blockers.push(`${pendingDays.size} correction request(s) are still waiting for review.`);
  }

  return {
    timeZone: env.OFFICE_TIMEZONE,
    today,
    view,
    ...period,
    employee: { id: user.id, name: user.name, employeeCode: user.employeeCode },
    shift: shift && { startTime: shift.startTime, endTime: shift.endTime },
    days,
    blockers,
    submission: sheet ? {
      id: sheet.id,
      status: sheet.status,
      submittedAt: sheet.submittedAt,
      reviewer: sheet.reviewer?.name ?? null,
      reviewedAt: sheet.reviewedAt,
      reviewNote: sheet.reviewNote,
    } : null,
    totals: {
      // Unfinished days have no worked time yet, so totals only cover completed days.
      workedMinutes: sum((r) => r.workedMinutes),
      overtimeMinutes: sum((r) => r.overtimeMinutes),
      lateMinutes: sum((r) => r.lateMinutes),
      present: count('PRESENT', 'LATE'),
      late: count('LATE'),
      halfDay: count('HALF_DAY'),
      absent: count('ABSENT'),
      missingCheckOut,
    },
  };
}

export async function getTeamDay(actor: User, date: string | undefined, now = new Date()) {
  const today = officeTime(now).date;
  const day = date ?? today;
  if (day > today) throw new HttpError(400, 'You cannot view a future date');

  const [users, holiday, sheets] = await Promise.all([
    db.user.findMany({
      where: { active: true, ...(actor.role === Role.ADMIN ? {} : { managerId: actor.id }) },
      orderBy: { employeeCode: 'asc' },
      include: { department: { select: { name: true } }, shift: { select: { name: true, weeklyOffDays: true } } },
    }),
    db.holiday.findUnique({ where: { date: dayToDb(day) } }),
    db.timesheet.findMany({ where: { periodStart: monthStart(day), status: { not: 'REJECTED' } } }),
  ]);
  const frozenByUser = new Map(sheets.map((s) => [s.userId, s.statuses as Record<string, string>]));
  // People who hadn't joined yet aren't part of that day.
  const members = users.filter((u) => officeTime(u.createdAt).date <= day);
  const records = await db.attendance.findMany({
    where: { date: dayToDb(day), userId: { in: members.map((u) => u.id) } },
    include: { breaks: true },
  });
  const recordByUser = new Map(records.map((r) => [r.userId, r]));

  const rows = members.map((u) => {
    const record = recordByUser.get(u.id);
    return {
      id: u.id,
      employeeCode: u.employeeCode,
      name: u.name,
      department: u.department?.name ?? null,
      shift: u.shift?.name ?? null,
      status: frozenByUser.get(u.id)?.[day] ?? dayStatus(day, today, record, holiday?.name ?? null, u.shift?.weeklyOffDays ?? null),
      record: record ? serialize(record) : null,
    };
  });

  // Every person falls into exactly one of these, apart from late, which overlaps the others.
  const count = (...statuses: string[]) => rows.filter((r) => statuses.includes(r.status)).length;
  return {
    timeZone: env.OFFICE_TIMEZONE,
    today,
    date: day,
    holiday: holiday?.name ?? null,
    summary: {
      total: rows.length,
      atWork: count('IN_PROGRESS', 'ON_BREAK'),
      checkedOut: rows.filter((r) => r.record?.checkOutAt).length,
      noCheckOut: count('MISSING_CHECK_OUT'),
      notIn: count('NOT_CHECKED_IN') + rows.filter((r) => r.status === 'ABSENT' && !r.record).length,
      off: count('WEEKLY_OFF', 'HOLIDAY'),
      noShift: count('NO_SHIFT'),
      late: rows.filter((r) => r.record?.lateMinutes).length,
    },
    rows,
  };
}
