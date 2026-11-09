import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Role, type User } from '../src/generated/prisma/client.js';
import { forgottenCheckoutJob } from '../src/jobs/index.js';
import { runJob } from '../src/jobs/runner.js';
import { db } from '../src/lib/db.js';
import { calcDay, calcLateMinutes } from '../src/services/attendanceCalc.js';
import { runForgottenCheckoutJob } from '../src/services/forgottenCheckout.js';
import { loginAs, makeUser, resetDb } from './helpers.js';

// Wednesday 4 Nov 2026. Times are India time (UTC+5:30).
const ist = (day: string, time: string) => new Date(`${day}T${time}:00+05:30`);
const WED = '2026-11-04';
const THU = '2026-11-05';
const setNow = (day: string, time: string) => vi.setSystemTime(ist(day, time));
const run = (day: string, time: string) => runForgottenCheckoutJob(ist(day, time));

beforeEach(async () => {
  await resetDb();
  vi.useFakeTimers({ toFake: ['Date'] });
  setNow(WED, '08:00');
});
afterEach(() => vi.useRealTimers());
afterAll(() => db.$disconnect());

async function org() {
  const day = await db.shift.create({ data: { name: 'Day', startTime: '09:00', endTime: '18:00' } });
  const night = await db.shift.create({ data: { name: 'Night', startTime: '22:00', endTime: '06:00', graceMinutes: 15, fullDayMinutes: 420, halfDayMinutes: 240, overtimeAfterMins: 480 } });
  const person = async (code: string, role: Role, managerId?: string, shiftId = day.id) => {
    const user = await makeUser(code, role, managerId);
    return db.user.update({ where: { id: user.id }, data: { shiftId, createdAt: ist('2026-10-01', '09:00') } });
  };
  const admin = await person('ADM', Role.ADMIN);
  const hr = await person('HR1', Role.HR);
  const boss = await person('BOSS', Role.MANAGER);
  const otherBoss = await person('OTHER', Role.MANAGER);
  const emp = await person('EMP', Role.EMPLOYEE, boss.id);
  const outsider = await person('OUT', Role.EMPLOYEE, otherBoss.id);
  const as = async (u: User) => (await loginAs(u.email)).agent;
  return { day, night, admin, hr, boss, otherBoss, emp, outsider, person, as };
}

const notesFor = (userId: string) => db.notification.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } });
const alertFor = (userId: string) => db.forgottenCheckoutAlert.findFirst({ where: { userId } });

async function checkIn(agent: Awaited<ReturnType<Awaited<ReturnType<typeof org>>['as']>>, day: string, time: string) {
  setNow(day, time);
  const res = await agent.post('/api/attendance/check-in');
  expect(res.status).toBe(200);
  return res;
}

describe('detection', () => {
  it('alerts an employee who forgets to check out, once the grace period has passed', async () => {
    const o = await org();
    await checkIn(await o.as(o.emp), WED, '09:00');

    expect((await run(WED, '18:14')).alertsCreated).toBe(0);
    expect(await alertFor(o.emp.id)).toBeNull();

    const summary = await run(WED, '18:15');
    expect(summary).toMatchObject({ alertsCreated: 1, notificationsQueued: 1, failed: 0 });
    const alert = await alertFor(o.emp.id);
    expect(alert).toMatchObject({ status: 'AWAITING_CHECKOUT', alertCount: 1, scheduledEndAt: ist(WED, '18:00') });
    const [note] = await notesFor(o.emp.id);
    expect(note).toMatchObject({ type: 'FORGOTTEN_CHECKOUT', title: "You haven't checked out" });
    expect(note.body).toContain('6:00 pm');
  });

  it('does nothing for someone who checked out before the alert time', async () => {
    const o = await org();
    const agent = await o.as(o.emp);
    await checkIn(agent, WED, '09:00');
    setNow(WED, '17:59');
    await agent.post('/api/attendance/check-out');
    await run(WED, '20:00');
    expect(await alertFor(o.emp.id)).toBeNull();
    expect(await notesFor(o.emp.id)).toHaveLength(0);
  });

  it('never sends the same alert twice, even when runs overlap', async () => {
    const o = await org();
    await checkIn(await o.as(o.emp), WED, '09:00');
    await run(WED, '18:15');
    await run(WED, '18:16');
    await Promise.all([run(WED, '18:31'), run(WED, '18:31'), run(WED, '18:32')]);
    expect(await db.forgottenCheckoutAlert.count()).toBe(1);
    const notes = await notesFor(o.emp.id);
    expect(notes.map((n) => n.dedupeKey.split(':').pop()).sort()).toEqual(['1', '2']);
  });

  it('only one server runs the job at a time', async () => {
    const now = ist(WED, '18:20');
    const results = await Promise.all([runJob(forgottenCheckoutJob, now), runJob(forgottenCheckoutJob, now)]);
    expect(results.filter((r) => r.ran)).toHaveLength(1);
    const job = await db.jobRun.findUnique({ where: { name: 'forgotten-checkouts' } });
    expect(job?.lastFinishedAt).not.toBeNull();
    expect(job?.lockedUntil).toBeNull();
  });

  it('keeps going when one person cannot be processed', async () => {
    const o = await org();
    await checkIn(await o.as(o.emp), WED, '09:00');
    // A record with an impossible shift time makes its own processing fail.
    await db.attendance.create({
      data: {
        userId: o.outsider.id, date: new Date(`${WED}T00:00:00Z`), checkInAt: ist(WED, '09:00'), shiftName: 'Broken',
        shiftStart: '09:00', shiftEnd: '29:99', graceMinutes: 0, fullDayMinutes: 480, halfDayMinutes: 240, overtimeAfterMins: 540, scheduled: true,
      },
    });
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    const summary = await run(WED, '18:20');
    quiet.mockRestore();
    expect(summary).toMatchObject({ failed: 1, alertsCreated: 1 });
    expect(await alertFor(o.emp.id)).not.toBeNull();
  });

  it('sends nothing when alerts are turned off', async () => {
    const o = await org();
    await db.forgottenCheckoutSettings.create({ data: { id: 1, enabled: false } });
    await checkIn(await o.as(o.emp), WED, '09:00');
    await run(WED, '23:00');
    expect(await alertFor(o.emp.id)).toBeNull();
  });

  it('records email delivery, and notes when no email server is set up', async () => {
    const o = await org();
    await checkIn(await o.as(o.emp), WED, '09:00');
    await run(WED, '18:15');
    const [note] = await notesFor(o.emp.id);
    expect(note).toMatchObject({ emailStatus: 'NOT_CONFIGURED', emailAttempts: 1 });
  });
});

describe('reminders and escalation', () => {
  it('repeats reminders up to the limit, then tells the manager, then HR', async () => {
    const o = await org();
    await checkIn(await o.as(o.emp), WED, '09:00');

    await run(WED, '18:15');
    await run(WED, '18:30');
    expect(await alertFor(o.emp.id)).toMatchObject({ status: 'REMINDER_SENT', alertCount: 2 });

    await run(WED, '19:00');
    expect(await alertFor(o.emp.id)).toMatchObject({ status: 'ESCALATED', alertCount: 3 });
    expect((await notesFor(o.boss.id)).map((n) => n.type)).toEqual(['FORGOTTEN_CHECKOUT_ESCALATION']);
    expect(await notesFor(o.hr.id)).toHaveLength(0);

    await run(WED, '22:00');
    expect(await alertFor(o.emp.id)).toMatchObject({ status: 'REQUIRES_HR_REVIEW', alertCount: 3 });
    expect(await notesFor(o.hr.id)).toHaveLength(1);
    // HR exists, so admins aren't also escalated to.
    expect(await notesFor(o.admin.id)).toHaveLength(0);

    await run(WED, '23:30');
    expect(await notesFor(o.emp.id)).toHaveLength(3);
    expect(await notesFor(o.boss.id)).toHaveLength(1);
    expect(await notesFor(o.hr.id)).toHaveLength(1);
  });

  it('follows the configured timings and recipients', async () => {
    const o = await org();
    await db.forgottenCheckoutSettings.create({
      data: { id: 1, alertAfterMinutes: 30, repeatReminders: false, notifyManager: false, hrAfterMinutes: 60 },
    });
    await checkIn(await o.as(o.emp), WED, '09:00');
    await run(WED, '18:29');
    expect(await alertFor(o.emp.id)).toBeNull();
    await run(WED, '18:30');
    await run(WED, '18:59');
    expect(await alertFor(o.emp.id)).toMatchObject({ alertCount: 1, status: 'AWAITING_CHECKOUT' });
    await run(WED, '19:00');
    expect(await alertFor(o.emp.id)).toMatchObject({ status: 'REQUIRES_HR_REVIEW' });
    expect(await notesFor(o.boss.id)).toHaveLength(0);
  });

  it('catches up after downtime with a single reminder, not a burst', async () => {
    const o = await org();
    await checkIn(await o.as(o.emp), WED, '09:00');
    await run(WED, '21:00');
    expect(await notesFor(o.emp.id)).toHaveLength(1);
    expect(await alertFor(o.emp.id)).toMatchObject({ alertCount: 3, status: 'ESCALATED' });
  });

  it('goes to the admins when there is no HR', async () => {
    const o = await org();
    await db.user.update({ where: { id: o.hr.id }, data: { active: false } });
    await checkIn(await o.as(o.emp), WED, '09:00');
    await run(WED, '22:00');
    expect(await notesFor(o.admin.id)).toHaveLength(1);
  });
});

describe('resolution', () => {
  it('resolves as soon as the employee checks out', async () => {
    const o = await org();
    const agent = await o.as(o.emp);
    await checkIn(agent, WED, '09:00');
    await run(WED, '18:15');
    setNow(WED, '18:20');
    expect((await agent.post('/api/attendance/check-out')).status).toBe(200);
    expect(await alertFor(o.emp.id)).toMatchObject({ status: 'RESOLVED', resolution: 'CHECKED_OUT', resolvedAt: ist(WED, '18:20') });
    await run(WED, '19:00');
    expect(await notesFor(o.emp.id)).toHaveLength(1);
    expect(await notesFor(o.boss.id)).toHaveLength(0);
  });

  it('lets an employee explain, raises a correction, and resolves when it is approved', async () => {
    const o = await org();
    const agent = await o.as(o.emp);
    await checkIn(agent, WED, '09:00');
    await run(WED, '18:15');
    const alert = (await alertFor(o.emp.id))!;

    setNow(WED, '19:00');
    const res = await agent.post(`/api/forgotten-checkouts/${alert.id}/explanation`).send({ explanation: 'Left in a hurry', leftAt: '18:05' });
    expect(res.status).toBe(204);
    expect((await agent.post(`/api/forgotten-checkouts/${alert.id}/explanation`).send({ explanation: 'Again' })).status).toBe(409);

    const correction = await db.correctionRequest.findFirstOrThrow({ where: { userId: o.emp.id } });
    expect(correction).toMatchObject({ status: 'PENDING', requestedCheckOutAt: ist(WED, '18:05'), requestedCheckInAt: ist(WED, '09:00') });
    expect((await notesFor(o.boss.id)).map((n) => n.type)).toContain('FORGOTTEN_CHECKOUT_EXPLANATION');

    const mine = await agent.get('/api/forgotten-checkouts/mine');
    expect(mine.body.alerts[0]).toMatchObject({ explanation: 'Left in a hurry', canExplain: false, status: 'AWAITING_CHECKOUT' });

    const boss = await o.as(o.boss);
    expect((await boss.post(`/api/corrections/${correction.id}/approve`)).status).toBe(204);
    expect(await alertFor(o.emp.id)).toMatchObject({ status: 'RESOLVED', resolution: 'CORRECTED' });
  });

  it('accepts an explanation without a leaving time, raising no correction', async () => {
    const o = await org();
    const agent = await o.as(o.emp);
    await checkIn(agent, WED, '09:00');
    await run(WED, '18:15');
    const alert = (await alertFor(o.emp.id))!;
    expect((await agent.post(`/api/forgotten-checkouts/${alert.id}/explanation`).send({ explanation: 'Phone died' })).status).toBe(204);
    expect(await db.correctionRequest.count()).toBe(0);
  });

  it('lets the manager remind, escalate and close', async () => {
    const o = await org();
    await checkIn(await o.as(o.emp), WED, '09:00');
    await run(WED, '18:15');
    const alert = (await alertFor(o.emp.id))!;
    const boss = await o.as(o.boss);

    setNow(WED, '18:20');
    const tooSoon = await boss.post(`/api/forgotten-checkouts/${alert.id}/remind`);
    expect(tooSoon.status).toBe(409);
    expect(tooSoon.body.error).toContain('5 minutes');

    setNow(WED, '18:25');
    expect((await boss.post(`/api/forgotten-checkouts/${alert.id}/remind`)).status).toBe(204);
    expect(await alertFor(o.emp.id)).toMatchObject({ alertCount: 2, status: 'REMINDER_SENT' });
    expect((await notesFor(o.emp.id)).at(-1)?.body).toContain('BOSS reminded you');

    expect((await boss.post(`/api/forgotten-checkouts/${alert.id}/escalate`).send({ note: '' })).status).toBe(400);
    expect((await boss.post(`/api/forgotten-checkouts/${alert.id}/escalate`).send({ note: 'Not answering' })).status).toBe(204);
    expect(await alertFor(o.emp.id)).toMatchObject({ status: 'REQUIRES_HR_REVIEW' });
    expect((await notesFor(o.hr.id))[0].body).toContain('Not answering');
    expect((await boss.post(`/api/forgotten-checkouts/${alert.id}/escalate`).send({ note: 'Again' })).status).toBe(409);

    const hr = await o.as(o.hr);
    expect((await hr.post(`/api/forgotten-checkouts/${alert.id}/resolve`).send({ note: 'Spoke to them, will correct' })).status).toBe(204);
    expect(await alertFor(o.emp.id)).toMatchObject({ status: 'RESOLVED', resolution: 'CLOSED' });
    expect((await boss.post(`/api/forgotten-checkouts/${alert.id}/resolve`).send({ note: 'x' })).status).toBe(409);

    const events = await db.forgottenCheckoutEvent.findMany({ where: { alertId: alert.id }, orderBy: { createdAt: 'asc' } });
    // Events written in the same transaction can share a timestamp, so the order isn't checked here.
    expect(events.map((e) => e.type).sort()).toEqual(['CREATED', 'ESCALATED_TO_HR', 'MANUAL_REMINDER', 'REMINDER', 'RESOLVED']);
    expect(events.find((e) => e.type === 'RESOLVED')).toMatchObject({ actorId: o.hr.id, note: 'Spoke to them, will correct' });
    expect(events.find((e) => e.type === 'ESCALATED_TO_HR')).toMatchObject({ actorId: o.boss.id, note: 'Not answering' });
  });
});

describe('overnight shifts', () => {
  it('works out lateness and leaving early across midnight', () => {
    const rules = { shiftStart: '22:00', shiftEnd: '06:00', graceMinutes: 15, fullDayMinutes: 420, halfDayMinutes: 240, overtimeAfterMins: 480, scheduled: true };
    expect(calcLateMinutes(ist(WED, '21:50'), rules)).toBe(0);
    expect(calcLateMinutes(ist(WED, '22:20'), rules)).toBe(20);
    expect(calcLateMinutes(ist(THU, '00:30'), rules)).toBe(150);
    expect(calcDay(ist(WED, '22:00'), ist(THU, '05:00'), [], rules)).toMatchObject({ workedMinutes: 420, earlyLeaveMinutes: 60, status: 'PRESENT' });
    expect(calcDay(ist(WED, '22:00'), ist(THU, '06:30'), [], rules)).toMatchObject({ workedMinutes: 510, earlyLeaveMinutes: 0, overtimeMinutes: 30 });
  });

  it('keeps a night shift open past midnight and alerts only after it ends', async () => {
    const o = await org();
    const nightWorker = await o.person('NIGHT', Role.EMPLOYEE, o.boss.id, o.night.id);
    // Sessions last 16 hours, so log in when the shift starts.
    setNow(WED, '21:55');
    const agent = await o.as(nightWorker);
    const res = await checkIn(agent, WED, '22:05');
    expect(res.body.record).toMatchObject({ date: WED, lateMinutes: 0 });

    setNow(THU, '03:00');
    const today = await agent.get('/api/attendance/today');
    expect(today.body.record).toMatchObject({ date: WED, checkOutAt: null });
    expect(today.body.missedCheckOutDate).toBeNull();
    const recent = await agent.get('/api/attendance/recent?days=2');
    expect(recent.body.days.find((d: { date: string }) => d.date === WED).status).toBe('IN_PROGRESS');

    await run(THU, '06:14');
    expect(await alertFor(nightWorker.id)).toBeNull();
    await run(THU, '06:15');
    expect(await alertFor(nightWorker.id)).toMatchObject({ scheduledEndAt: ist(THU, '06:00') });

    setNow(THU, '06:20');
    const out = await agent.post('/api/attendance/check-out');
    expect(out.status).toBe(200);
    expect(out.body.record).toMatchObject({ date: WED, workedMinutes: 495, earlyLeaveMinutes: 0 });
    expect(await alertFor(nightWorker.id)).toMatchObject({ status: 'RESOLVED', resolution: 'CHECKED_OUT' });

    // The finished shift stays on the Home page until halfway to tonight's, then check-in is offered again.
    setNow(THU, '13:59');
    const later = await o.as(nightWorker);
    expect((await later.get('/api/attendance/today')).body.record).toMatchObject({ date: WED });
    setNow(THU, '14:00');
    expect((await later.get('/api/attendance/today')).body.record).toBeNull();
  });

  it('counts a check-in after midnight towards the shift that started the evening before', async () => {
    const o = await org();
    const nightWorker = await o.person('NIGHT', Role.EMPLOYEE, undefined, o.night.id);
    setNow(THU, '00:25');
    const res = await checkIn(await o.as(nightWorker), THU, '00:30');
    expect(res.body.record).toMatchObject({ date: WED, lateMinutes: 150 });
  });

  it('does not let a day shift check out of yesterday', async () => {
    const o = await org();
    await checkIn(await o.as(o.emp), WED, '09:00');
    setNow(THU, '09:00');
    const res = await (await o.as(o.emp)).post('/api/attendance/check-out');
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('You have not checked in today');
  });

  it('places an overnight correction check-out on the next morning', async () => {
    const o = await org();
    const nightWorker = await o.person('NIGHT', Role.EMPLOYEE, o.boss.id, o.night.id);
    setNow(THU, '12:00');
    const res = await (await o.as(nightWorker)).post('/api/corrections').send({ date: WED, checkIn: '22:00', checkOut: '06:00', breakMinutes: 30, reason: 'Forgot' });
    expect(res.status).toBe(201);
    const c = await db.correctionRequest.findFirstOrThrow();
    expect(c.requestedCheckOutAt).toEqual(ist(THU, '06:00'));
  });
});

describe('access', () => {
  it('shows each reviewer only the alerts they may see', async () => {
    const o = await org();
    await checkIn(await o.as(o.emp), WED, '09:00');
    await checkIn(await o.as(o.outsider), WED, '09:00');
    await run(WED, '18:15');

    const ids = async (u: User) => (await (await o.as(u)).get('/api/forgotten-checkouts')).body.alerts.map((a: { employee: { employeeCode: string } }) => a.employee.employeeCode).sort();
    expect(await ids(o.boss)).toEqual(['EMP']);
    expect(await ids(o.otherBoss)).toEqual(['OUT']);
    expect(await ids(o.hr)).toEqual(['EMP', 'OUT']);
    expect(await ids(o.admin)).toEqual(['EMP', 'OUT']);
    expect((await (await o.as(o.emp)).get('/api/forgotten-checkouts')).status).toBe(403);
  });

  it("stops people acting on alerts outside their team, or on someone else's behalf", async () => {
    const o = await org();
    await checkIn(await o.as(o.emp), WED, '09:00');
    await run(WED, '18:15');
    const alert = (await alertFor(o.emp.id))!;
    setNow(WED, '19:00');

    expect((await (await o.as(o.otherBoss)).post(`/api/forgotten-checkouts/${alert.id}/remind`)).status).toBe(403);
    expect((await (await o.as(o.otherBoss)).post(`/api/forgotten-checkouts/${alert.id}/resolve`).send({ note: 'x' })).status).toBe(403);
    expect((await (await o.as(o.outsider)).post(`/api/forgotten-checkouts/${alert.id}/explanation`).send({ explanation: 'x' })).status).toBe(404);
    expect((await (await o.as(o.emp)).post(`/api/forgotten-checkouts/${alert.id}/resolve`).send({ note: 'x' })).status).toBe(403);
  });

  it('lets only admins change the settings', async () => {
    const o = await org();
    const settings = {
      enabled: true, alertAfterMinutes: 10, repeatReminders: true, reminderIntervalMinutes: 20, maxReminders: 2,
      notifyEmployee: true, notifyManager: true, managerAfterMinutes: 45, notifyHr: false, hrAfterMinutes: 120, sendEmail: false,
    };
    expect((await (await o.as(o.hr)).put('/api/forgotten-checkouts/settings').send(settings)).status).toBe(403);
    expect((await (await o.as(o.boss)).get('/api/forgotten-checkouts/settings')).status).toBe(403);
    const hrView = await (await o.as(o.hr)).get('/api/forgotten-checkouts/settings');
    expect(hrView.body).toMatchObject({ settings: { alertAfterMinutes: 15 }, emailConfigured: false });

    const admin = await o.as(o.admin);
    expect((await admin.put('/api/forgotten-checkouts/settings').send({ ...settings, reminderIntervalMinutes: 1 })).status).toBe(400);
    expect((await admin.put('/api/forgotten-checkouts/settings').send({ ...settings, managerAfterMinutes: 5 })).status).toBe(400);
    const saved = await admin.put('/api/forgotten-checkouts/settings').send(settings);
    expect(saved.status).toBe(200);
    expect(saved.body.settings).toMatchObject({ ...settings, updatedById: o.admin.id });
  });

  it('lets an admin run the check straight away', async () => {
    const o = await org();
    await checkIn(await o.as(o.emp), WED, '09:00');
    setNow(WED, '18:30');
    const res = await (await o.as(o.admin)).post('/api/forgotten-checkouts/run');
    expect(res.status).toBe(200);
    expect(res.body.summary).toMatchObject({ alertsCreated: 1 });
    expect((await (await o.as(o.boss)).post('/api/forgotten-checkouts/run')).status).toBe(403);
  });
});

describe('notifications API', () => {
  it('lists, counts and marks notifications as read, for their owner only', async () => {
    const o = await org();
    await checkIn(await o.as(o.emp), WED, '09:00');
    await run(WED, '18:15');
    await run(WED, '18:30');

    const agent = await o.as(o.emp);
    let res = await agent.get('/api/notifications');
    expect(res.body.unread).toBe(2);
    const [latest] = res.body.notifications;
    expect(latest).not.toHaveProperty('dedupeKey');

    expect((await (await o.as(o.boss)).post(`/api/notifications/${latest.id}/read`)).status).toBe(404);
    expect((await agent.post(`/api/notifications/${latest.id}/read`)).status).toBe(204);
    expect((await agent.get('/api/notifications')).body.unread).toBe(1);
    await agent.post('/api/notifications/read-all');
    res = await agent.get('/api/notifications');
    expect(res.body.unread).toBe(0);
  });
});
