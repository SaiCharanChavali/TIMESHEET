import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Role, type User } from '../src/generated/prisma/client.js';
import { db } from '../src/lib/db.js';
import { officeDateTime } from '../src/lib/officeTime.js';
import { loginAs, makeUser, resetDb } from './helpers.js';

const ist = (day: string, time: string) => new Date(`${day}T${time}:00+05:30`);
const dbDay = (day: string) => new Date(`${day}T00:00:00Z`);
const setNow = (day: string, time: string) => vi.setSystemTime(ist(day, time));

// Wednesday 4 Nov 2026, so October is over and November isn't.
beforeEach(async () => {
  await resetDb();
  vi.useFakeTimers({ toFake: ['Date'] });
  setNow('2026-11-04', '12:00');
});
afterEach(() => vi.useRealTimers());
afterAll(() => db.$disconnect());

async function org() {
  const shift = await db.shift.create({ data: { name: 'Day', startTime: '09:00', endTime: '18:00' } });
  const person = async (code: string, role: Role, managerId?: string, joined = '2026-10-29') => {
    const user = await makeUser(code, role, managerId);
    return db.user.update({ where: { id: user.id }, data: { shiftId: shift.id, createdAt: ist(joined, '09:00') } });
  };
  const admin = await person('ADM', Role.ADMIN);
  const boss = await person('BOSS', Role.MANAGER);
  const other = await person('OTHER', Role.MANAGER);
  const emp = await person('EMP', Role.EMPLOYEE, boss.id);
  const outsider = await person('OUT', Role.EMPLOYEE, other.id);
  const as = async (u: User) => (await loginAs(u.email)).agent;
  return { shift, admin, boss, other, emp, outsider, person, as };
}

const request = (over = {}) => ({ date: '2026-11-03', checkIn: '09:00', checkOut: '18:00', breakMinutes: 60, reason: 'Forgot to check out', ...over });

async function rawRecord(user: User, day: string, checkIn: string, checkOut?: string) {
  return db.attendance.create({
    data: {
      userId: user.id, date: dbDay(day), checkInAt: ist(day, checkIn), checkOutAt: checkOut ? ist(day, checkOut) : null, shiftName: 'Day',
      shiftStart: '09:00', shiftEnd: '18:00', graceMinutes: 15, fullDayMinutes: 480, halfDayMinutes: 240, overtimeAfterMins: 540, scheduled: true,
      ...(checkOut ? { status: 'PRESENT' as const, workedMinutes: 480, breakMinutes: 0 } : {}),
    },
  });
}

const firstPendingId = async (u: User) => (await db.correctionRequest.findFirstOrThrow({ where: { userId: u.id, status: 'PENDING' } })).id;

describe('officeDateTime', () => {
  it('converts an office time to the exact moment', () => {
    expect(officeDateTime('2026-11-04', '09:30').toISOString()).toBe('2026-11-04T04:00:00.000Z');
    expect(officeDateTime('2026-11-04', '00:15').toISOString()).toBe('2026-11-03T18:45:00.000Z');
    expect(officeDateTime('2026-11-04', '23:45').toISOString()).toBe('2026-11-04T18:15:00.000Z');
  });
});

describe('requesting a correction', () => {
  it.each([
    ['a future date', { date: '2026-11-05' }, 400],
    ['a date before joining', { date: '2026-10-01' }, 400],
    ['check-out before check-in', { checkIn: '18:00', checkOut: '09:00' }, 400],
    ['check-out equal to check-in', { checkIn: '09:00', checkOut: '09:00' }, 400],
    ['breaks longer than the day', { checkIn: '09:00', checkOut: '10:00', breakMinutes: 60 }, 400],
    ['negative breaks', { breakMinutes: -5 }, 400],
    ['a badly formatted time', { checkIn: '9am' }, 400],
    ['an impossible date', { date: '2026-02-31' }, 400],
    ['a blank reason', { reason: '  ' }, 400],
  ])('refuses %s', async (_label, over, status) => {
    const { emp, as } = await org();
    expect((await (await as(emp)).post('/api/corrections').send(request(over))).status).toBe(status);
  });

  it('refuses a check-out later today', async () => {
    const { emp, as } = await org();
    const res = await (await as(emp)).post('/api/corrections').send(request({ date: '2026-11-04', checkOut: '18:00' }));
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/future/);
  });

  it('allows only one waiting request per day, and another after it is dealt with', async () => {
    const { emp, boss, as } = await org();
    const agent = await as(emp);
    expect((await agent.post('/api/corrections').send(request())).status).toBe(201);
    expect((await agent.post('/api/corrections').send(request())).status).toBe(409);
    await (await as(boss)).post(`/api/corrections/${await firstPendingId(emp)}/reject`).send({ note: 'Please check the time' });
    expect((await agent.post('/api/corrections').send(request())).status).toBe(201);
  });

  it('simultaneous requests create only one', async () => {
    const { emp, as } = await org();
    const agent = await as(emp);
    const results = await Promise.all(Array.from({ length: 4 }, () => agent.post('/api/corrections').send(request())));
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(await db.correctionRequest.count()).toBe(1);
  });

  it('does not change attendance until approved', async () => {
    const { emp, as } = await org();
    await rawRecord(emp, '2026-11-03', '10:00');
    await (await as(emp)).post('/api/corrections').send(request());
    const record = await db.attendance.findFirstOrThrow({ where: { userId: emp.id } });
    expect(record.checkOutAt).toBeNull();
    expect(record.correctedAt).toBeNull();
  });

  it('only the owner can cancel, and only while waiting', async () => {
    const { emp, outsider, boss, as } = await org();
    const agent = await as(emp);
    await agent.post('/api/corrections').send(request());
    const id = await firstPendingId(emp);
    expect((await (await as(outsider)).delete(`/api/corrections/${id}`)).status).toBe(409);
    expect((await agent.delete(`/api/corrections/${id}`)).status).toBe(204);
    expect((await agent.delete(`/api/corrections/${id}`)).status).toBe(409);
    expect((await (await as(boss)).post(`/api/corrections/${id}/approve`)).status).toBe(409);
  });
});

describe('approving a correction', () => {
  it('fixes a forgotten check-out and recalculates using the day\'s original rules', async () => {
    const { emp, boss, shift, as } = await org();
    await rawRecord(emp, '2026-11-03', '09:30');
    const agent = await as(emp);
    await agent.post('/api/corrections').send(request({ checkIn: '09:30', checkOut: '18:30', breakMinutes: 45 }));
    await db.shift.update({ where: { id: shift.id }, data: { startTime: '06:00' } });

    const reviewer = await as(boss);
    const list = await reviewer.get('/api/approvals');
    expect(list.body.corrections[0].outcome).toEqual({ status: 'LATE', workedMinutes: 495 });
    expect((await reviewer.post(`/api/corrections/${await firstPendingId(emp)}/approve`)).status).toBe(204);

    const { body } = await agent.get('/api/attendance/timesheet?view=day&date=2026-11-03');
    expect(body.days[0].status).toBe('LATE');
    expect(body.days[0].record).toMatchObject({ workedMinutes: 495, breakMinutes: 45, lateMinutes: 30, shiftStart: '09:00' });
    expect(body.days[0].record.correctedAt).not.toBeNull();
    expect((await agent.get('/api/attendance/today')).body.missedCheckOutDate).toBeNull();
  });

  it('keeps what the day looked like before, as history', async () => {
    const { emp, boss, as } = await org();
    await rawRecord(emp, '2026-11-03', '09:30');
    const agent = await as(emp);
    await agent.post('/api/corrections').send(request());
    await (await as(boss)).post(`/api/corrections/${await firstPendingId(emp)}/approve`);
    const { body } = await agent.get('/api/corrections/mine');
    expect(body.corrections[0]).toMatchObject({ status: 'APPROVED', reviewer: 'BOSS' });
    expect(body.corrections[0].originalCheckInAt).toBe(ist('2026-11-03', '09:30').toISOString());
    expect(body.corrections[0].originalCheckOutAt).toBeNull();
  });

  it('creates the day when there was no record, turning an absence into attendance', async () => {
    const { emp, boss, as } = await org();
    const agent = await as(emp);
    const before = await agent.get('/api/attendance/timesheet?view=day&date=2026-11-03');
    expect(before.body.days[0].status).toBe('ABSENT');
    await agent.post('/api/corrections').send(request());
    await (await as(boss)).post(`/api/corrections/${await firstPendingId(emp)}/approve`);
    const after = await agent.get('/api/attendance/timesheet?view=day&date=2026-11-03');
    expect(after.body.days[0].status).toBe('PRESENT');
    expect(after.body.days[0].record.workedMinutes).toBe(480);
  });

  it('replaces breaks, including one left open', async () => {
    const { emp, boss, as } = await org();
    const record = await rawRecord(emp, '2026-11-03', '09:00');
    await db.break.create({ data: { attendanceId: record.id, startAt: ist('2026-11-03', '13:00') } });
    await (await as(emp)).post('/api/corrections').send(request({ breakMinutes: 30 }));
    await (await as(boss)).post(`/api/corrections/${await firstPendingId(emp)}/approve`);
    expect(await db.break.count({ where: { attendanceId: record.id } })).toBe(0);
    expect((await db.attendance.findUniqueOrThrow({ where: { id: record.id } }))).toMatchObject({ breakMinutes: 30, workedMinutes: 510 });
  });

  it('two reviewers acting at once: only one succeeds', async () => {
    const { emp, boss, admin, as } = await org();
    await (await as(emp)).post('/api/corrections').send(request());
    const id = await firstPendingId(emp);
    const [a, b] = await Promise.all([as(boss), as(admin)]);
    const results = await Promise.all([a.post(`/api/corrections/${id}/approve`), b.post(`/api/corrections/${id}/reject`).send({ note: 'No, not right' })]);
    expect(results.map((r) => r.status).sort()).toEqual([204, 409]);
  });

  it('rejection needs a reason, shows it to the employee, and changes nothing', async () => {
    const { emp, boss, as } = await org();
    const agent = await as(emp);
    await agent.post('/api/corrections').send(request());
    const id = await firstPendingId(emp);
    const reviewer = await as(boss);
    expect((await reviewer.post(`/api/corrections/${id}/reject`).send({ note: '' })).status).toBe(400);
    expect((await reviewer.post(`/api/corrections/${id}/reject`).send({ note: 'Badge log says 10am' })).status).toBe(204);
    const { body } = await agent.get('/api/corrections/mine');
    expect(body.corrections[0]).toMatchObject({ status: 'REJECTED', reviewNote: 'Badge log says 10am' });
    expect(await db.attendance.count({ where: { userId: emp.id } })).toBe(0);
  });
});

describe('who can review', () => {
  it('employees cannot, nor can another team\'s manager', async () => {
    const { emp, outsider, other, as } = await org();
    await (await as(emp)).post('/api/corrections').send(request());
    const id = await firstPendingId(emp);
    expect((await (await as(outsider)).post(`/api/corrections/${id}/approve`)).status).toBe(403);
    expect((await (await as(outsider)).get('/api/approvals')).status).toBe(403);
    expect((await (await as(other)).post(`/api/corrections/${id}/approve`)).status).toBe(403);
    expect((await (await as(other)).get('/api/approvals')).body.count).toBe(0);
  });

  it('a manager cannot approve their own request, but an admin can', async () => {
    const { boss, admin, as } = await org();
    const agent = await as(boss);
    await agent.post('/api/corrections').send(request());
    const id = await firstPendingId(boss);
    expect((await agent.post(`/api/corrections/${id}/approve`)).status).toBe(403);
    expect((await agent.get('/api/approvals')).body.count).toBe(0);
    expect((await (await as(admin)).post(`/api/corrections/${id}/approve`)).status).toBe(204);
  });

  it('an admin cannot approve their own while another admin exists', async () => {
    const { admin, person, as } = await org();
    const second = await person('ADM2', Role.ADMIN);
    const agent = await as(admin);
    await agent.post('/api/corrections').send(request());
    const id = await firstPendingId(admin);
    expect((await agent.post(`/api/corrections/${id}/approve`)).status).toBe(403);
    expect((await agent.get('/api/approvals')).body.count).toBe(0);
    expect((await (await as(second)).post(`/api/corrections/${id}/approve`)).status).toBe(204);
  });

  it('the only admin can approve their own, so nothing gets stuck', async () => {
    const { admin, as } = await org();
    const agent = await as(admin);
    await agent.post('/api/corrections').send(request());
    expect((await agent.get('/api/approvals')).body.count).toBe(1);
    expect((await agent.post(`/api/corrections/${await firstPendingId(admin)}/approve`)).status).toBe(204);
  });

  it('a manager loses review rights as soon as the person changes team', async () => {
    const { emp, boss, other, as } = await org();
    await (await as(emp)).post('/api/corrections').send(request());
    await db.user.update({ where: { id: emp.id }, data: { managerId: other.id } });
    expect((await (await as(boss)).post(`/api/corrections/${await firstPendingId(emp)}/approve`)).status).toBe(403);
  });
});

describe('monthly timesheets', () => {
  const OCT = { month: '2026-10' };

  it('cannot submit a month that has not ended, is blank, or is malformed', async () => {
    const { emp, as } = await org();
    const agent = await as(emp);
    const current = await agent.post('/api/timesheets/submit').send({ month: '2026-11' });
    expect(current.status).toBe(409);
    expect(current.body.error).toMatch(/once it has ended/);
    expect((await agent.post('/api/timesheets/submit').send({ month: '2026-08' })).status).toBe(409);
    expect((await agent.post('/api/timesheets/submit').send({ month: '2026-13' })).status).toBe(400);
  });

  it('cannot submit with a missing check-out or a waiting correction', async () => {
    const { emp, boss, as } = await org();
    const agent = await as(emp);
    await rawRecord(emp, '2026-10-29', '09:00');
    const missing = await agent.post('/api/timesheets/submit').send(OCT);
    expect(missing.status).toBe(409);
    expect(missing.body.error).toMatch(/no check-out/);

    await agent.post('/api/corrections').send(request({ date: '2026-10-29' }));
    const waiting = await agent.post('/api/timesheets/submit').send(OCT);
    expect(waiting.body.error).toMatch(/still waiting/);

    await (await as(boss)).post(`/api/corrections/${await firstPendingId(emp)}/approve`);
    expect((await agent.post('/api/timesheets/submit').send(OCT)).status).toBe(204);
  });

  it('runs submit, reject with a reason, fix, resubmit, approve', async () => {
    const { emp, boss, as } = await org();
    const agent = await as(emp);
    const reviewer = await as(boss);
    expect((await agent.post('/api/timesheets/submit').send(OCT)).status).toBe(204);

    const pending = await reviewer.get('/api/approvals');
    expect(pending.body.timesheets[0]).toMatchObject({ month: '2026-10', employee: { name: 'EMP' } });
    const id = pending.body.timesheets[0].id;

    expect((await reviewer.post(`/api/timesheets/${id}/reject`).send({ note: 'Thursday looks wrong' })).status).toBe(204);
    const rejected = await agent.get('/api/attendance/timesheet?view=month&date=2026-10-15');
    expect(rejected.body.submission).toMatchObject({ status: 'REJECTED', reviewNote: 'Thursday looks wrong', reviewer: 'BOSS' });
    expect(rejected.body.days[0].locked).toBe(false);

    expect((await agent.post('/api/corrections').send(request({ date: '2026-10-29' }))).status).toBe(201);
    await reviewer.post(`/api/corrections/${await firstPendingId(emp)}/approve`);

    expect((await agent.post('/api/timesheets/submit').send(OCT)).status).toBe(204);
    expect((await reviewer.post(`/api/timesheets/${id}/approve`)).status).toBe(204);
    const approved = await agent.get('/api/attendance/timesheet?view=month&date=2026-10-15');
    expect(approved.body.submission).toMatchObject({ status: 'APPROVED', reviewNote: null });
    expect(approved.body.days.every((d: { locked: boolean }) => d.locked)).toBe(true);
    expect(approved.body.totals.workedMinutes).toBe(480);
  });

  it('a submitted or approved month refuses corrections and repeat submission', async () => {
    const { emp, boss, as } = await org();
    const agent = await as(emp);
    await agent.post('/api/timesheets/submit').send(OCT);
    const whileSubmitted = await agent.post('/api/corrections').send(request({ date: '2026-10-29' }));
    expect(whileSubmitted.status).toBe(409);
    expect(whileSubmitted.body.error).toMatch(/submitted/);
    expect((await agent.post('/api/timesheets/submit').send(OCT)).status).toBe(409);

    const reviewer = await as(boss);
    const { id } = await db.timesheet.findFirstOrThrow();
    await reviewer.post(`/api/timesheets/${id}/approve`);
    const whileApproved = await agent.post('/api/corrections').send(request({ date: '2026-10-29' }));
    expect(whileApproved.status).toBe(409);
    expect(whileApproved.body.error).toMatch(/approved and locked/);
    expect((await agent.post('/api/timesheets/withdraw').send(OCT)).status).toBe(409);
    expect((await reviewer.post(`/api/timesheets/${id}/approve`)).status).toBe(409);
  });

  it('a correction requested before submission cannot be approved into a locked month', async () => {
    const { emp, boss, as } = await org();
    const agent = await as(emp);
    await agent.post('/api/corrections').send(request({ date: '2026-10-29' }));
    const id = await firstPendingId(emp);
    // Reached directly, because normal use can't submit past a waiting request.
    await db.timesheet.create({ data: { userId: emp.id, periodStart: dbDay('2026-10-01'), status: 'APPROVED', submittedAt: new Date(), workedMinutes: 0, overtimeMinutes: 0, statuses: {} } });
    expect((await (await as(boss)).post(`/api/corrections/${id}/approve`)).status).toBe(409);
    expect((await db.correctionRequest.findUniqueOrThrow({ where: { id } })).status).toBe('PENDING');
  });

  it('withdrawing unlocks the month', async () => {
    const { emp, as } = await org();
    const agent = await as(emp);
    await agent.post('/api/timesheets/submit').send(OCT);
    expect((await agent.post('/api/timesheets/withdraw').send(OCT)).status).toBe(204);
    expect((await agent.post('/api/corrections').send(request({ date: '2026-10-29' }))).status).toBe(201);
  });

  it('only an admin can reopen, with a reason, and it can then be corrected', async () => {
    const { emp, boss, admin, as } = await org();
    const agent = await as(emp);
    await agent.post('/api/timesheets/submit').send(OCT);
    const { id } = await db.timesheet.findFirstOrThrow();
    const manager = await as(boss);
    await manager.post(`/api/timesheets/${id}/approve`);

    expect((await manager.post(`/api/timesheets/${id}/reopen`).send({ note: 'Please reopen' })).status).toBe(403);
    const adminAgent = await as(admin);
    expect((await adminAgent.post(`/api/timesheets/${id}/reopen`).send({ note: '' })).status).toBe(400);
    expect((await adminAgent.post(`/api/timesheets/${id}/reopen`).send({ note: 'Payroll found an error' })).status).toBe(204);
    expect((await agent.post('/api/corrections').send(request({ date: '2026-10-29' }))).status).toBe(201);
  });

  it('an approved month keeps its statuses after a shift or holiday changes', async () => {
    const { emp, boss, admin, shift, as } = await org();
    const agent = await as(emp);
    await agent.post('/api/timesheets/submit').send(OCT);
    await (await as(boss)).post(`/api/timesheets/${(await db.timesheet.findFirstOrThrow()).id}/approve`);

    const statuses = async () => (await agent.get('/api/attendance/timesheet?view=month&date=2026-10-15')).body.days.map((d: { status: string }) => d.status);
    const before = await statuses();
    expect(before).toEqual(['ABSENT', 'ABSENT', 'WEEKLY_OFF']); // 29, 30 and 31 Oct

    await db.shift.update({ where: { id: shift.id }, data: { weeklyOffDays: [] } });
    await db.holiday.create({ data: { date: dbDay('2026-10-29'), name: 'Festival' } });
    expect(await statuses()).toEqual(before);

    const team = await (await as(admin)).get('/api/attendance/team?date=2026-10-29');
    expect(team.body.rows.find((r: { employeeCode: string }) => r.employeeCode === 'EMP').status).toBe('ABSENT');
    expect(team.body.rows.find((r: { employeeCode: string }) => r.employeeCode === 'OUT').status).toBe('HOLIDAY');
  });

  it('a rejected month is not frozen', async () => {
    const { emp, boss, as } = await org();
    const agent = await as(emp);
    await agent.post('/api/timesheets/submit').send(OCT);
    await (await as(boss)).post(`/api/timesheets/${(await db.timesheet.findFirstOrThrow()).id}/reject`).send({ note: 'Please recheck' });
    await db.holiday.create({ data: { date: dbDay('2026-10-29'), name: 'Festival' } });
    const { body } = await agent.get('/api/attendance/timesheet?view=month&date=2026-10-15');
    expect(body.days[0].status).toBe('HOLIDAY');
  });

  it('a week across two months locks only the locked month\'s days', async () => {
    const { emp, boss, as } = await org();
    const agent = await as(emp);
    await agent.post('/api/timesheets/submit').send(OCT);
    await (await as(boss)).post(`/api/timesheets/${(await db.timesheet.findFirstOrThrow()).id}/approve`);
    const { body } = await agent.get('/api/attendance/timesheet?view=week&date=2026-11-01');
    expect(body.days.map((d: { date: string; locked: boolean }) => [d.date, d.locked])).toEqual([
      ['2026-10-29', true], ['2026-10-30', true], ['2026-10-31', true], ['2026-11-01', false],
    ]);
    expect(body.submission).toBeNull();
    expect(body.blockers).toEqual([]);
  });

  it('managers can read a report\'s submission but employees cannot read another\'s', async () => {
    const { emp, boss, outsider, as } = await org();
    await (await as(emp)).post('/api/timesheets/submit').send(OCT);
    const url = `/api/attendance/timesheet?view=month&date=2026-10-15&userId=${emp.id}`;
    expect((await (await as(boss)).get(url)).body.submission.status).toBe('SUBMITTED');
    expect((await (await as(outsider)).get(url)).status).toBe(403);
  });
});
