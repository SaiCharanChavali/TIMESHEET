import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Role, type User } from '../src/generated/prisma/client.js';
import { db } from '../src/lib/db.js';
import { loginAs, makeUser, resetDb } from './helpers.js';

// 4 Nov 2026 is a Wednesday. Times are written in India time.
const ist = (day: string, time: string) => new Date(`${day}T${time}:00+05:30`);
const dbDay = (day: string) => new Date(`${day}T00:00:00Z`);
const setNow = (day: string, time: string) => vi.setSystemTime(ist(day, time));

beforeEach(async () => {
  await resetDb();
  vi.useFakeTimers({ toFake: ['Date'] });
  setNow('2026-11-04', '12:00');
});
afterEach(() => vi.useRealTimers());
afterAll(() => db.$disconnect());

async function shift() {
  return db.shift.create({ data: { name: 'Day', startTime: '09:00', endTime: '18:00' } });
}

async function person(code: string, role: Role, shiftId: string, managerId?: string, joined = '2026-09-01') {
  const user = await makeUser(code, role, managerId);
  return db.user.update({ where: { id: user.id }, data: { shiftId, createdAt: ist(joined, '09:00') } });
}

// Records a finished day through the real API, so that the stored numbers come from the real rules.
async function workDay(user: User, day: string, checkIn: string, checkOut: string) {
  setNow(day, checkIn);
  const { agent } = await loginAs(user.email);
  await agent.post('/api/attendance/check-in');
  setNow(day, checkOut);
  await agent.post('/api/attendance/check-out');
  setNow('2026-11-04', '12:00');
}

describe('timesheet periods', () => {
  async function get(view: string, date: string) {
    const s = await shift();
    const user = await person('E1', Role.EMPLOYEE, s.id);
    const { agent } = await loginAs(user.email);
    return agent.get(`/api/attendance/timesheet?view=${view}&date=${date}`);
  }

  it.each([
    ['2026-11-04', '2026-11-02', '2026-11-08', 'a Wednesday'],
    ['2026-11-02', '2026-11-02', '2026-11-08', 'a Monday'],
    ['2026-11-08', '2026-11-02', '2026-11-08', 'a Sunday'],
    ['2026-12-31', '2026-12-28', '2027-01-03', 'a week across the new year'],
  ])('week containing %s runs %s to %s (%s)', async (date, from, to) => {
    const { body } = await get('week', date);
    expect(body).toMatchObject({ from, to });
  });

  it.each([
    ['2026-11-15', '2026-11-01', '2026-11-30'],
    ['2026-12-31', '2026-12-01', '2026-12-31'],
    ['2026-01-31', '2026-01-01', '2026-01-31'],
    ['2026-02-10', '2026-02-01', '2026-02-28'],
    ['2028-02-10', '2028-02-01', '2028-02-29'],
  ])('month containing %s runs %s to %s', async (date, from, to) => {
    const { body } = await get('month', date);
    expect(body).toMatchObject({ from, to });
  });

  it('day view is one day', async () => {
    const { body } = await get('day', '2026-11-03');
    expect(body).toMatchObject({ from: '2026-11-03', to: '2026-11-03' });
    expect(body.days).toHaveLength(1);
  });

  it('never lists future days or days before joining', async () => {
    const s = await shift();
    const user = await person('E2', Role.EMPLOYEE, s.id, undefined, '2026-11-03');
    const { agent } = await loginAs(user.email);
    const { body } = await agent.get('/api/attendance/timesheet?view=month&date=2026-11-10');
    expect(body.days.map((d: { date: string }) => d.date)).toEqual(['2026-11-03', '2026-11-04']);

    const future = await agent.get('/api/attendance/timesheet?view=month&date=2027-01-10');
    expect(future.body.days).toEqual([]);
  });

  it('rejects bad parameters', async () => {
    const s = await shift();
    const user = await person('E3', Role.EMPLOYEE, s.id);
    const { agent } = await loginAs(user.email);
    expect((await agent.get('/api/attendance/timesheet?view=year')).status).toBe(400);
    expect((await agent.get('/api/attendance/timesheet?date=2026-02-31')).status).toBe(400);
    expect((await agent.get('/api/attendance/timesheet?userId=not-an-id')).status).toBe(400);
  });
});

describe('timesheet totals', () => {
  it('adds up a mixed week and leaves unfinished days out of worked time', async () => {
    const s = await shift();
    const user = await person('T1', Role.EMPLOYEE, s.id);
    await workDay(user, '2026-11-02', '09:00', '19:30'); // Present: 10h30, 1h30 overtime
    await workDay(user, '2026-11-03', '09:30', '18:30'); // Late: 9h, 30 min late
    setNow('2026-11-04', '09:00');
    const { agent } = await loginAs(user.email);
    await agent.post('/api/attendance/check-in'); // Still at work today
    setNow('2026-11-04', '12:00');

    const { body } = await agent.get('/api/attendance/timesheet?view=week&date=2026-11-04');
    expect(body.days.map((d: { status: string }) => d.status)).toEqual(['PRESENT', 'LATE', 'IN_PROGRESS']);
    expect(body.totals).toEqual({
      workedMinutes: 630 + 540, overtimeMinutes: 90, lateMinutes: 30,
      present: 2, late: 1, halfDay: 0, absent: 0, missingCheckOut: 0,
    });
  });

  it('counts half days, absences and forgotten check-outs', async () => {
    const s = await shift();
    const user = await person('T2', Role.EMPLOYEE, s.id, undefined, '2026-11-02');
    await workDay(user, '2026-11-02', '09:00', '14:00'); // Half day

    setNow('2026-11-03', '09:00');
    const { agent } = await loginAs(user.email);
    await agent.post('/api/attendance/check-in'); // Never checks out

    setNow('2026-11-06', '12:00');
    const fresh = await loginAs(user.email);
    const { body } = await fresh.agent.get('/api/attendance/timesheet?view=week&date=2026-11-06');
    expect(body.days.map((d: { status: string }) => d.status)).toEqual(['HALF_DAY', 'MISSING_CHECK_OUT', 'ABSENT', 'ABSENT', 'NOT_CHECKED_IN']);
    expect(body.totals).toMatchObject({ halfDay: 1, absent: 2, missingCheckOut: 1, workedMinutes: 300, present: 0 });
  });
});

describe('who can see whose timesheet', () => {
  async function org() {
    const s = await shift();
    const admin = await person('ADM', Role.ADMIN, s.id);
    const boss = await person('BOSS', Role.MANAGER, s.id);
    const other = await person('OTHER', Role.MANAGER, s.id);
    const report = await person('REP', Role.EMPLOYEE, s.id, boss.id);
    const outsider = await person('OUT', Role.EMPLOYEE, s.id, other.id);
    return { admin, boss, other, report, outsider };
  }
  const ghost = '00000000-0000-4000-8000-000000000000';
  const url = (id: string) => `/api/attendance/timesheet?userId=${id}`;

  it('employees see only themselves', async () => {
    const { report, outsider, boss } = await org();
    const { agent } = await loginAs(report.email);
    expect((await agent.get('/api/attendance/timesheet')).body.employee.id).toBe(report.id);
    expect((await agent.get(url(report.id))).status).toBe(200);
    expect((await agent.get(url(outsider.id))).status).toBe(403);
    expect((await agent.get(url(boss.id))).status).toBe(403);
    expect((await agent.get(url(ghost))).status).toBe(403);
  });

  it('managers see their own reports, and nobody else', async () => {
    const { boss, report, outsider, admin } = await org();
    const { agent } = await loginAs(boss.email);
    expect((await agent.get(url(report.id))).body.employee.id).toBe(report.id);
    expect((await agent.get(url(outsider.id))).status).toBe(403);
    expect((await agent.get(url(admin.id))).status).toBe(403);
    // The same answer as a real person on another team, so this can't be used to find out who exists.
    expect((await agent.get(url(ghost))).status).toBe(403);
  });

  it('a manager loses access as soon as the person moves teams', async () => {
    const { boss, other, report } = await org();
    const { agent } = await loginAs(boss.email);
    await db.user.update({ where: { id: report.id }, data: { managerId: other.id } });
    expect((await agent.get(url(report.id))).status).toBe(403);
  });

  it('admins see anyone, including people who have left', async () => {
    const { admin, outsider } = await org();
    await db.user.update({ where: { id: outsider.id }, data: { active: false } });
    const { agent } = await loginAs(admin.email);
    expect((await agent.get(url(outsider.id))).status).toBe(200);
    expect((await agent.get(url(ghost))).status).toBe(404);
  });

  it('never exposes password data', async () => {
    const { admin, report } = await org();
    const { agent } = await loginAs(admin.email);
    const sheet = await agent.get(url(report.id));
    const team = await agent.get('/api/attendance/team');
    expect(JSON.stringify(sheet.body) + JSON.stringify(team.body)).not.toMatch(/passwordHash|tokenVersion/);
  });
});

describe('team day', () => {
  it('sorts everyone into one group and adds up to the team size', async () => {
    const s = await shift();
    const admin = await person('A0', Role.ADMIN, s.id);
    const atWork = await person('A1', Role.EMPLOYEE, s.id);
    const onBreak = await person('A2', Role.EMPLOYEE, s.id);
    const done = await person('A3', Role.EMPLOYEE, s.id);
    await person('A4', Role.EMPLOYEE, s.id); // Not in yet
    const noShift = await makeUser('A5', Role.EMPLOYEE);
    await db.user.update({ where: { id: noShift.id }, data: { createdAt: ist('2026-09-01', '09:00') } });

    const late = await db.attendance.create({
      data: {
        userId: atWork.id, date: dbDay('2026-11-04'), checkInAt: ist('2026-11-04', '09:30'), lateMinutes: 30, shiftName: 'Day',
        shiftStart: '09:00', shiftEnd: '18:00', graceMinutes: 15, fullDayMinutes: 480, halfDayMinutes: 240, overtimeAfterMins: 540, scheduled: true,
      },
    });
    expect(late.lateMinutes).toBe(30);
    setNow('2026-11-04', '09:00');
    const b = await loginAs(onBreak.email);
    await b.agent.post('/api/attendance/check-in');
    await b.agent.post('/api/attendance/break/start');
    const d = await loginAs(done.email);
    await d.agent.post('/api/attendance/check-in');
    await d.agent.post('/api/attendance/check-out');
    setNow('2026-11-04', '12:00');

    const { agent } = await loginAs(admin.email);
    const { body } = await agent.get('/api/attendance/team');
    expect(body.summary).toEqual({ total: 6, atWork: 2, checkedOut: 1, noCheckOut: 0, notIn: 2, off: 0, noShift: 1, late: 1 });
    const { summary } = body;
    expect(summary.atWork + summary.checkedOut + summary.noCheckOut + summary.notIn + summary.off + summary.noShift).toBe(summary.total);
    expect(body.rows.map((r: { employeeCode: string; status: string }) => [r.employeeCode, r.status])).toEqual([
      ['A0', 'NOT_CHECKED_IN'], ['A1', 'IN_PROGRESS'], ['A2', 'ON_BREAK'], ['A3', 'ABSENT'], ['A4', 'NOT_CHECKED_IN'], ['A5', 'NO_SHIFT'],
    ]);
  });

  it('a past day shows absences, and leaves out people who had not joined', async () => {
    const s = await shift();
    const admin = await person('B0', Role.ADMIN, s.id);
    await person('B1', Role.EMPLOYEE, s.id, undefined, '2026-11-04');
    const { agent } = await loginAs(admin.email);
    const { body } = await agent.get('/api/attendance/team?date=2026-11-03');
    expect(body.rows.map((r: { employeeCode: string; status: string }) => [r.employeeCode, r.status])).toEqual([['B0', 'ABSENT']]);
    expect(body.summary).toMatchObject({ total: 1, notIn: 1 });
  });

  it('counts a checked-out person who worked too little as checked out, not also as not in', async () => {
    const s = await shift();
    const admin = await person('C0', Role.ADMIN, s.id);
    const short = await person('C1', Role.EMPLOYEE, s.id);
    await workDay(short, '2026-11-03', '09:00', '10:00');
    const { agent } = await loginAs(admin.email);
    const { body } = await agent.get('/api/attendance/team?date=2026-11-03');
    expect(body.summary).toMatchObject({ total: 2, checkedOut: 1, notIn: 1 });
  });

  it('shows holidays and weekly offs as off, not absent', async () => {
    const s = await shift();
    const admin = await person('D0', Role.ADMIN, s.id);
    await db.holiday.create({ data: { date: dbDay('2026-11-03'), name: 'Festival' } });
    const { agent } = await loginAs(admin.email);
    const holiday = await agent.get('/api/attendance/team?date=2026-11-03');
    expect(holiday.body).toMatchObject({ holiday: 'Festival', summary: { off: 1, notIn: 0 } });
    const saturday = await agent.get('/api/attendance/team?date=2026-10-31');
    expect(saturday.body.summary).toMatchObject({ off: 1, notIn: 0 });
  });

  it('managers see only their direct reports, without inactive ones', async () => {
    const s = await shift();
    const boss = await person('M1', Role.MANAGER, s.id);
    const other = await person('M2', Role.MANAGER, s.id);
    await person('E1', Role.EMPLOYEE, s.id, boss.id);
    await person('E2', Role.EMPLOYEE, s.id, other.id);
    const left = await person('E3', Role.EMPLOYEE, s.id, boss.id);
    await db.user.update({ where: { id: left.id }, data: { active: false } });
    const { agent } = await loginAs(boss.email);
    const { body } = await agent.get('/api/attendance/team');
    expect(body.rows.map((r: { employeeCode: string }) => r.employeeCode)).toEqual(['E1']);
  });

  it('employees are refused, and future dates are rejected', async () => {
    const s = await shift();
    const employee = await person('F1', Role.EMPLOYEE, s.id);
    const admin = await person('F2', Role.ADMIN, s.id);
    expect((await (await loginAs(employee.email)).agent.get('/api/attendance/team')).status).toBe(403);
    expect((await (await loginAs(admin.email)).agent.get('/api/attendance/team?date=2026-11-05')).status).toBe(400);
  });
});
