import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Role } from '../src/generated/prisma/client.js';
import { db } from '../src/lib/db.js';
import { officeTime } from '../src/lib/officeTime.js';
import { calcDay, calcLateMinutes } from '../src/services/attendanceCalc.js';
import { loginAs, makeUser, resetDb } from './helpers.js';

// 4 Nov 2026 is a Wednesday. India is UTC+5:30, and times below are written in India time.
const ist = (day: string, time: string) => new Date(`${day}T${time}:00+05:30`);
const WED = '2026-11-04';
const THU = '2026-11-05';
const SAT = '2026-11-07';

const setNow = (day: string, time: string) => vi.setSystemTime(ist(day, time));

const rules = {
  shiftStart: '09:00', shiftEnd: '18:00', graceMinutes: 15, fullDayMinutes: 480,
  halfDayMinutes: 240, overtimeAfterMins: 540, scheduled: true,
};

describe('office time', () => {
  it('uses India time for the calendar day, whatever the UTC date is', () => {
    expect(officeTime(new Date('2026-11-04T18:29:00Z'))).toEqual({ date: WED, minutes: 23 * 60 + 59 });
    expect(officeTime(new Date('2026-11-04T18:30:00Z'))).toEqual({ date: THU, minutes: 0 });
  });
});

describe('late calculation', () => {
  it.each([
    ['08:30', 0], ['09:00', 0], ['09:15', 0], ['09:16', 16], ['10:00', 60],
  ])('checking in at %s is %i minutes late', (time, expected) => {
    expect(calcLateMinutes(ist(WED, time), rules)).toBe(expected);
  });

  it('ignores seconds inside the last grace minute', () => {
    expect(calcLateMinutes(new Date(`${WED}T09:15:59+05:30`), rules)).toBe(0);
  });

  it('is never late on an unscheduled day', () => {
    expect(calcLateMinutes(ist(SAT, '13:00'), { ...rules, scheduled: false })).toBe(0);
  });
});

describe('day calculation', () => {
  const day = (inAt: string, outAt: string, breaks: [string, string][] = [], over = {}) =>
    calcDay(ist(WED, inAt), ist(WED, outAt), breaks.map(([s, e]) => ({ startAt: ist(WED, s), endAt: ist(WED, e) })), { ...rules, ...over });

  it('a normal day is present with no overtime', () => {
    expect(day('09:00', '18:00', [['13:00', '14:00']])).toEqual({
      workedMinutes: 480, breakMinutes: 60, lateMinutes: 0, earlyLeaveMinutes: 0, overtimeMinutes: 0, status: 'PRESENT',
    });
  });

  it('adds up several breaks and takes them out of worked time', () => {
    const result = day('09:00', '18:30', [['11:00', '11:15'], ['13:00', '13:45']]);
    expect(result.breakMinutes).toBe(60);
    expect(result.workedMinutes).toBe(510);
  });

  it('late with a full day is LATE', () => {
    expect(day('09:30', '18:30')).toMatchObject({ status: 'LATE', lateMinutes: 30, workedMinutes: 540 });
  });

  it('exactly at the thresholds', () => {
    expect(day('09:00', '17:00').status).toBe('PRESENT');
    expect(day('09:00', '16:59').status).toBe('HALF_DAY');
    expect(day('09:00', '13:00').status).toBe('HALF_DAY');
    expect(day('09:00', '12:59').status).toBe('ABSENT');
  });

  it('a late half day stays HALF_DAY and keeps the late minutes', () => {
    expect(day('11:00', '16:00')).toMatchObject({ status: 'HALF_DAY', lateMinutes: 120 });
  });

  it('counts leaving early and overtime', () => {
    expect(day('09:00', '17:00').earlyLeaveMinutes).toBe(60);
    expect(day('08:00', '18:30').overtimeMinutes).toBe(90);
    expect(day('09:00', '18:00').overtimeMinutes).toBe(0);
  });

  it('all work on an unscheduled day is overtime', () => {
    expect(day('10:00', '12:00', [], { scheduled: false })).toEqual({
      workedMinutes: 120, breakMinutes: 0, lateMinutes: 0, earlyLeaveMinutes: 0, overtimeMinutes: 120, status: 'PRESENT',
    });
  });
});

describe('attendance API', () => {
  beforeEach(async () => {
    await resetDb();
    vi.useFakeTimers({ toFake: ['Date'] });
  });
  afterEach(() => vi.useRealTimers());
  afterAll(() => db.$disconnect());

  async function employee(code = 'E1') {
    const shift = await db.shift.create({ data: { name: `Shift ${code}`, startTime: '09:00', endTime: '18:00' } });
    const user = await makeUser(code, Role.EMPLOYEE);
    await db.user.update({ where: { id: user.id }, data: { shiftId: shift.id, createdAt: ist('2026-10-01', '09:00') } });
    const { agent } = await loginAs(user.email);
    return { user, shift, agent };
  }

  it('runs a full day: check in, break, check out', async () => {
    setNow(WED, '09:05');
    const { agent } = await employee();

    let res = await agent.post('/api/attendance/check-in');
    expect(res.status).toBe(200);
    expect(res.body.record).toMatchObject({ date: WED, lateMinutes: 0, status: null, shiftName: 'Shift E1' });
    expect(res.body.record.checkInAt).toBe(ist(WED, '09:05').toISOString());

    setNow(WED, '13:00');
    res = await agent.post('/api/attendance/break/start');
    expect(res.body.record.breaks[0].endAt).toBeNull();

    setNow(WED, '13:45');
    res = await agent.post('/api/attendance/break/end');
    expect(res.body.record.breaks[0].endAt).toBe(ist(WED, '13:45').toISOString());

    setNow(WED, '18:05');
    res = await agent.post('/api/attendance/check-out');
    expect(res.body.record).toMatchObject({ workedMinutes: 495, breakMinutes: 45, overtimeMinutes: 0, status: 'PRESENT' });
  });

  it('ignores any time or user sent by the browser', async () => {
    setNow(WED, '10:00');
    const { agent, user } = await employee();
    const other = await makeUser('E2', Role.EMPLOYEE);
    const res = await agent.post('/api/attendance/check-in').send({ checkInAt: ist(WED, '09:00').toISOString(), userId: other.id });
    expect(res.body.record.checkInAt).toBe(ist(WED, '10:00').toISOString());
    expect(res.body.record.lateMinutes).toBe(60);
    expect(await db.attendance.count({ where: { userId: user.id } })).toBe(1);
    expect(await db.attendance.count({ where: { userId: other.id } })).toBe(0);
  });

  it('refuses actions in the wrong order', async () => {
    setNow(WED, '09:00');
    const { agent } = await employee();
    expect((await agent.post('/api/attendance/check-out')).status).toBe(409);
    expect((await agent.post('/api/attendance/break/start')).status).toBe(409);

    await agent.post('/api/attendance/check-in');
    expect((await agent.post('/api/attendance/check-in')).status).toBe(409);
    expect((await agent.post('/api/attendance/break/end')).status).toBe(409);

    await agent.post('/api/attendance/break/start');
    expect((await agent.post('/api/attendance/break/start')).status).toBe(409);

    await agent.post('/api/attendance/check-out');
    expect((await agent.post('/api/attendance/check-out')).status).toBe(409);
    expect((await agent.post('/api/attendance/check-in')).status).toBe(409);
    expect((await agent.post('/api/attendance/break/start')).status).toBe(409);
  });

  it('survives simultaneous clicks without duplicating anything', async () => {
    setNow(WED, '09:00');
    const { agent, user } = await employee();
    const checkIns = await Promise.all(Array.from({ length: 5 }, () => agent.post('/api/attendance/check-in')));
    expect(checkIns.filter((r) => r.status === 200)).toHaveLength(1);
    expect(checkIns.filter((r) => r.status === 409)).toHaveLength(4);
    expect(await db.attendance.count({ where: { userId: user.id } })).toBe(1);

    const breaks = await Promise.all(Array.from({ length: 5 }, () => agent.post('/api/attendance/break/start')));
    expect(breaks.filter((r) => r.status === 200)).toHaveLength(1);
    expect(await db.break.count()).toBe(1);

    const checkOuts = await Promise.all(Array.from({ length: 5 }, () => agent.post('/api/attendance/check-out')));
    expect(checkOuts.filter((r) => r.status === 200)).toHaveLength(1);
  });

  it('checking out during a break ends the break', async () => {
    setNow(WED, '09:00');
    const { agent } = await employee();
    await agent.post('/api/attendance/check-in');
    setNow(WED, '17:00');
    await agent.post('/api/attendance/break/start');
    setNow(WED, '17:30');
    const res = await agent.post('/api/attendance/check-out');
    expect(res.body.record.breaks[0].endAt).toBe(ist(WED, '17:30').toISOString());
    expect(res.body.record).toMatchObject({ breakMinutes: 30, workedMinutes: 480 });
  });

  it('a forgotten check-out cannot be closed the next day, and today still works', async () => {
    setNow(WED, '09:00');
    const { agent } = await employee();
    await agent.post('/api/attendance/check-in');

    setNow(THU, '09:00');
    const fresh = await loginAs('e1@test.local');
    expect((await fresh.agent.post('/api/attendance/check-out')).status).toBe(409);

    const today = await fresh.agent.get('/api/attendance/today');
    expect(today.body.missedCheckOutDate).toBe(WED);
    expect(today.body.record).toBeNull();

    expect((await fresh.agent.post('/api/attendance/check-in')).status).toBe(200);
    const recent = await fresh.agent.get('/api/attendance/recent?days=2');
    expect(recent.body.days.map((d: { status: string }) => d.status)).toEqual(['IN_PROGRESS', 'MISSING_CHECK_OUT']);
  });

  it('a check-in just after midnight India time belongs to the new day', async () => {
    setNow(THU, '00:05');
    const { agent } = await employee();
    const res = await agent.post('/api/attendance/check-in');
    expect(res.body.record.date).toBe(THU);
  });

  it('requires a shift', async () => {
    setNow(WED, '09:00');
    const user = await makeUser('NS', Role.EMPLOYEE);
    const { agent } = await loginAs(user.email);
    const res = await agent.post('/api/attendance/check-in');
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/no shift/);
  });

  it('editing a shift does not change an existing record', async () => {
    setNow(WED, '09:00');
    const { agent, shift } = await employee();
    await agent.post('/api/attendance/check-in');
    await db.shift.update({ where: { id: shift.id }, data: { startTime: '06:00', fullDayMinutes: 60, graceMinutes: 0 } });
    setNow(WED, '12:00');
    const res = await agent.post('/api/attendance/check-out');
    expect(res.body.record).toMatchObject({ lateMinutes: 0, status: 'ABSENT', shiftStart: '09:00' });
  });

  it('one employee cannot see or affect another', async () => {
    setNow(WED, '09:00');
    const a = await employee('A1');
    const b = await employee('B1');
    await a.agent.post('/api/attendance/check-in');
    expect((await b.agent.get('/api/attendance/today')).body.record).toBeNull();
    expect((await b.agent.post('/api/attendance/check-out')).status).toBe(409);
    expect((await a.agent.get('/api/attendance/today')).body.record.checkOutAt).toBeNull();
  });

  it('requires login and a changed temporary password', async () => {
    setNow(WED, '09:00');
    const { agent, user } = await employee();
    await db.user.update({ where: { id: user.id }, data: { mustChangePassword: true } });
    expect((await agent.post('/api/attendance/check-in')).status).toBe(403);
  });

  describe('recent days', () => {
    it('labels weekly offs, holidays, absences and today, and stops at the joining date', async () => {
      setNow(SAT, '10:00');
      const { user, agent } = await employee();
      await db.user.update({ where: { id: user.id }, data: { createdAt: ist('2026-11-02', '09:00') } }); // Monday
      const admin = await makeUser('ADM', Role.ADMIN);
      const { agent: adminAgent } = await loginAs(admin.email);
      expect((await adminAgent.post('/api/holidays').send({ date: '2026-11-03', name: 'Festival' })).status).toBe(201);

      const res = await agent.get('/api/attendance/recent?days=30');
      expect(res.body.days.map((d: { date: string; status: string }) => [d.date, d.status])).toEqual([
        ['2026-11-07', 'WEEKLY_OFF'],
        ['2026-11-06', 'ABSENT'],
        ['2026-11-05', 'ABSENT'],
        ['2026-11-04', 'ABSENT'],
        ['2026-11-03', 'HOLIDAY'],
        ['2026-11-02', 'ABSENT'],
      ]);
    });

    it('shows today as not checked in rather than absent', async () => {
      setNow(WED, '08:00');
      const { agent } = await employee();
      const res = await agent.get('/api/attendance/recent?days=1');
      expect(res.body.days[0].status).toBe('NOT_CHECKED_IN');
    });

    it('rejects an out-of-range request', async () => {
      setNow(WED, '08:00');
      const { agent } = await employee();
      expect((await agent.get('/api/attendance/recent?days=999')).status).toBe(400);
    });
  });

  it('working on a weekly off counts as overtime with no late mark', async () => {
    setNow(SAT, '13:00');
    const { agent } = await employee();
    const res = await agent.post('/api/attendance/check-in');
    expect(res.body.weeklyOff).toBe(true);
    expect(res.body.record).toMatchObject({ scheduled: false, lateMinutes: 0 });
    setNow(SAT, '15:00');
    const out = await agent.post('/api/attendance/check-out');
    expect(out.body.record).toMatchObject({ status: 'PRESENT', overtimeMinutes: 120 });
  });

  it('working on a holiday counts the same way', async () => {
    await db.holiday.create({ data: { date: new Date(`${WED}T00:00:00Z`), name: 'Festival' } });
    setNow(WED, '13:00');
    const { agent } = await employee();
    const res = await agent.post('/api/attendance/check-in');
    expect(res.body.holiday).toBe('Festival');
    expect(res.body.record.scheduled).toBe(false);
  });

  describe('holidays admin', () => {
    it('only admins can manage them', async () => {
      setNow(WED, '09:00');
      const { agent } = await employee();
      expect((await agent.get('/api/holidays')).status).toBe(403);
      expect((await agent.post('/api/holidays').send({ date: '2026-12-25', name: 'x' })).status).toBe(403);
    });

    it('validates dates and refuses duplicates', async () => {
      const admin = await makeUser('ADM2', Role.ADMIN);
      const { agent } = await loginAs(admin.email);
      expect((await agent.post('/api/holidays').send({ date: '2026-02-31', name: 'x' })).status).toBe(400);
      expect((await agent.post('/api/holidays').send({ date: 'soon', name: 'x' })).status).toBe(400);
      expect((await agent.post('/api/holidays').send({ date: '2026-12-25', name: ' ' })).status).toBe(400);
      const created = await agent.post('/api/holidays').send({ date: '2026-12-25', name: 'Christmas' });
      expect(created.body.holiday.date).toBe('2026-12-25');
      expect((await agent.post('/api/holidays').send({ date: '2026-12-25', name: 'Again' })).status).toBe(409);
      expect((await agent.delete(`/api/holidays/${created.body.holiday.id}`)).status).toBe(204);
      expect((await agent.delete(`/api/holidays/${created.body.holiday.id}`)).status).toBe(404);
    });
  });
});
