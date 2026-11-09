import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../src/app.js';
import { Role } from '../src/generated/prisma/client.js';
import { db } from '../src/lib/db.js';
import { loginAs, makeUser, resetDb } from './helpers.js';

beforeEach(resetDb);
afterAll(() => db.$disconnect());

async function admin(code = 'ADM') {
  const user = await makeUser(code, Role.ADMIN);
  const { agent } = await loginAs(user.email);
  return { user, agent };
}

const newUser = (over = {}) => ({
  employeeCode: 'n1', name: ' New Person ', email: 'New@Test.Local', role: 'EMPLOYEE',
  departmentId: null, shiftId: null, managerId: null, ...over,
});

const shift = (over = {}) => ({
  name: 'Day', startTime: '09:00', endTime: '18:00', graceMinutes: 15, fullDayMinutes: 480,
  halfDayMinutes: 240, overtimeAfterMins: 540, weeklyOffDays: [0, 6], ...over,
});

describe('who can manage', () => {
  it.each([Role.EMPLOYEE, Role.MANAGER])('%s cannot change anything', async (role) => {
    const user = await makeUser('U1', role);
    const other = await makeUser('U2', Role.EMPLOYEE);
    const { agent } = await loginAs(user.email);
    expect((await agent.post('/api/users').send(newUser())).status).toBe(403);
    expect((await agent.patch(`/api/users/${other.id}`).send({ name: 'x' })).status).toBe(403);
    expect((await agent.post(`/api/users/${other.id}/temporary-password`)).status).toBe(403);
    expect((await agent.post('/api/departments').send({ name: 'x' })).status).toBe(403);
    expect((await agent.post('/api/shifts').send(shift())).status).toBe(403);
    expect((await agent.get('/api/shifts')).status).toBe(403);
  });

  it('logged-out requests are rejected', async () => {
    expect((await request(app).post('/api/users').send(newUser())).status).toBe(401);
    expect((await request(app).get('/api/departments')).status).toBe(401);
  });
});

describe('creating employees', () => {
  it('normalises input, stores no plain password, and forces a change at first login', async () => {
    const { agent } = await admin();
    const res = await agent.post('/api/users').send(newUser());
    expect(res.status).toBe(201);
    const { temporaryPassword } = res.body;
    expect(temporaryPassword).toHaveLength(14);

    const stored = await db.user.findUniqueOrThrow({ where: { id: res.body.id } });
    expect(stored).toMatchObject({ employeeCode: 'N1', name: 'New Person', email: 'new@test.local', mustChangePassword: true });
    expect(stored.passwordHash).not.toContain(temporaryPassword);

    const { agent: employee, res: login } = await loginAs('new@test.local', temporaryPassword);
    expect(login.body.user.mustChangePassword).toBe(true);
    expect((await employee.get('/api/users')).status).toBe(403);
    expect((await employee.get('/api/auth/me')).status).toBe(200);

    const changed = await employee.post('/api/auth/change-password').send({ currentPassword: temporaryPassword, newPassword: 'my-own-password' });
    expect(changed.status).toBe(204);
    const me = await employee.get('/api/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.user.mustChangePassword).toBe(false);
  });

  it('never returns password hashes in the list', async () => {
    const { agent } = await admin();
    const res = await agent.get('/api/users');
    expect(JSON.stringify(res.body)).not.toContain('passwordHash');
  });

  it('rejects duplicates whatever the case', async () => {
    const { agent } = await admin();
    await agent.post('/api/users').send(newUser());
    const sameEmail = await agent.post('/api/users').send(newUser({ employeeCode: 'n2', email: 'NEW@test.local' }));
    expect(sameEmail.status).toBe(409);
    expect(sameEmail.body.error).toMatch(/email/);
    const sameCode = await agent.post('/api/users').send(newUser({ employeeCode: 'N1', email: 'b@test.local' }));
    expect(sameCode.status).toBe(409);
    expect(sameCode.body.error).toMatch(/code/);
  });

  it('rejects bad input and unknown references', async () => {
    const { agent } = await admin();
    expect((await agent.post('/api/users').send(newUser({ email: 'nope' }))).status).toBe(400);
    expect((await agent.post('/api/users').send(newUser({ name: '  ' }))).status).toBe(400);
    expect((await agent.post('/api/users').send(newUser({ role: 'OWNER' }))).status).toBe(400);
    const ghost = '00000000-0000-4000-8000-000000000000';
    expect((await agent.post('/api/users').send(newUser({ departmentId: ghost }))).status).toBe(400);
    expect((await agent.post('/api/users').send(newUser({ shiftId: ghost }))).status).toBe(400);
    expect((await agent.post('/api/users').send(newUser({ managerId: ghost }))).status).toBe(400);
  });

  it('ignores attempts to set protected fields', async () => {
    const { agent } = await admin();
    const res = await agent.post('/api/users').send(newUser({ passwordHash: 'x', tokenVersion: 99, mustChangePassword: false }));
    const stored = await db.user.findUniqueOrThrow({ where: { id: res.body.id } });
    expect(stored.passwordHash).not.toBe('x');
    expect(stored.tokenVersion).toBe(0);
    expect(stored.mustChangePassword).toBe(true);
  });
});

describe('manager rules', () => {
  it('requires an active manager or admin', async () => {
    const { agent } = await admin();
    const employee = await makeUser('E1', Role.EMPLOYEE);
    const target = await makeUser('E2', Role.EMPLOYEE);
    expect((await agent.patch(`/api/users/${target.id}`).send({ managerId: employee.id })).status).toBe(400);
    const off = await makeUser('M0', Role.MANAGER);
    await db.user.update({ where: { id: off.id }, data: { active: false } });
    expect((await agent.patch(`/api/users/${target.id}`).send({ managerId: off.id })).status).toBe(400);
  });

  it('prevents self-management and reporting loops', async () => {
    const { agent } = await admin();
    const top = await makeUser('M1', Role.MANAGER);
    const mid = await makeUser('M2', Role.MANAGER, top.id);
    const low = await makeUser('M3', Role.MANAGER, mid.id);
    expect((await agent.patch(`/api/users/${top.id}`).send({ managerId: top.id })).status).toBe(400);
    expect((await agent.patch(`/api/users/${top.id}`).send({ managerId: mid.id })).status).toBe(400);
    expect((await agent.patch(`/api/users/${top.id}`).send({ managerId: low.id })).status).toBe(400);
  });

  it('allows saving an employee whose manager is unchanged, even if that manager has left', async () => {
    const { agent } = await admin();
    const manager = await makeUser('M4', Role.MANAGER);
    const employee = await makeUser('E5', Role.EMPLOYEE, manager.id);
    await db.user.update({ where: { id: manager.id }, data: { active: false } });
    const res = await agent.patch(`/api/users/${employee.id}`).send({ name: 'Renamed', managerId: manager.id });
    expect(res.status).toBe(204);
  });
});

describe('deactivating and role changes', () => {
  it('deactivation ends sessions at once, and reactivating does not revive them', async () => {
    const { agent } = await admin();
    const user = await makeUser('E6', Role.EMPLOYEE);
    const { agent: employee } = await loginAs(user.email);
    expect((await employee.get('/api/auth/me')).status).toBe(200);

    expect((await agent.patch(`/api/users/${user.id}`).send({ active: false })).status).toBe(204);
    expect((await employee.get('/api/auth/me')).status).toBe(401);

    expect((await agent.patch(`/api/users/${user.id}`).send({ active: true })).status).toBe(204);
    expect((await employee.get('/api/auth/me')).status).toBe(401);
    expect((await loginAs(user.email)).res.status).toBe(200);
  });

  it('admins cannot lock themselves out', async () => {
    const { agent, user } = await admin();
    expect((await agent.patch(`/api/users/${user.id}`).send({ active: false })).status).toBe(400);
    expect((await agent.patch(`/api/users/${user.id}`).send({ role: 'EMPLOYEE' })).status).toBe(400);
    expect((await agent.patch(`/api/users/${user.id}`).send({ role: 'ADMIN', name: 'Same Role' })).status).toBe(204);
  });

  it('a manager with an active team cannot be deactivated or demoted', async () => {
    const { agent } = await admin();
    const manager = await makeUser('M5', Role.MANAGER);
    const report = await makeUser('E7', Role.EMPLOYEE, manager.id);
    expect((await agent.patch(`/api/users/${manager.id}`).send({ active: false })).status).toBe(409);
    expect((await agent.patch(`/api/users/${manager.id}`).send({ role: 'EMPLOYEE' })).status).toBe(409);

    await agent.patch(`/api/users/${report.id}`).send({ managerId: null });
    expect((await agent.patch(`/api/users/${manager.id}`).send({ active: false })).status).toBe(204);
  });

  it('a role change applies to existing sessions immediately', async () => {
    const { agent } = await admin();
    const manager = await makeUser('M6', Role.MANAGER);
    const { agent: session } = await loginAs(manager.email);
    expect((await session.get('/api/users')).status).toBe(200);
    await agent.patch(`/api/users/${manager.id}`).send({ role: 'EMPLOYEE' });
    expect((await session.get('/api/users')).status).toBe(403);
  });

  it('returns 404 for an unknown employee', async () => {
    const { agent } = await admin();
    expect((await agent.patch('/api/users/00000000-0000-4000-8000-000000000000').send({ name: 'x' })).status).toBe(404);
  });
});

describe('temporary passwords', () => {
  it('replaces the old password and ends existing sessions', async () => {
    const { agent } = await admin();
    const user = await makeUser('E8', Role.EMPLOYEE);
    const { agent: employee } = await loginAs(user.email);

    const res = await agent.post(`/api/users/${user.id}/temporary-password`);
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect((await employee.get('/api/auth/me')).status).toBe(401);
    expect((await loginAs(user.email)).res.status).toBe(401);
    const login = await loginAs(user.email, res.body.temporaryPassword);
    expect(login.res.body.user.mustChangePassword).toBe(true);
  });

  it('cannot be used on yourself', async () => {
    const { agent, user } = await admin();
    expect((await agent.post(`/api/users/${user.id}/temporary-password`)).status).toBe(400);
  });
});

describe('departments', () => {
  it('creates, renames and deletes', async () => {
    const { agent } = await admin();
    const created = await agent.post('/api/departments').send({ name: ' Sales ' });
    expect(created.body.department.name).toBe('Sales');
    const id = created.body.department.id;
    expect((await agent.put(`/api/departments/${id}`).send({ name: 'Revenue' })).body.department.name).toBe('Revenue');
    expect((await agent.delete(`/api/departments/${id}`)).status).toBe(204);
    expect((await agent.delete(`/api/departments/${id}`)).status).toBe(404);
  });

  it('rejects a duplicate name whatever the case, but allows keeping your own', async () => {
    const { agent } = await admin();
    const { body } = await agent.post('/api/departments').send({ name: 'Sales' });
    expect((await agent.post('/api/departments').send({ name: 'SALES' })).status).toBe(409);
    expect((await agent.put(`/api/departments/${body.department.id}`).send({ name: 'sales' })).status).toBe(200);
  });

  it('refuses to delete a department that still has employees', async () => {
    const { agent } = await admin();
    const { body } = await agent.post('/api/departments').send({ name: 'Sales' });
    await agent.post('/api/users').send(newUser({ departmentId: body.department.id }));
    expect((await agent.delete(`/api/departments/${body.department.id}`)).status).toBe(409);
  });
});

describe('shifts', () => {
  it('creates and updates, removing repeated weekly off days', async () => {
    const { agent } = await admin();
    const created = await agent.post('/api/shifts').send(shift({ weeklyOffDays: [6, 0, 6] }));
    expect(created.status).toBe(201);
    expect(created.body.shift.weeklyOffDays).toEqual([0, 6]);
    const updated = await agent.put(`/api/shifts/${created.body.shift.id}`).send(shift({ graceMinutes: 5 }));
    expect(updated.body.shift.graceMinutes).toBe(5);
  });

  it.each([
    ['badly formatted time', { startTime: '9am' }],
    ['impossible time', { endTime: '25:00' }],
    ['same start and end', { startTime: '09:00', endTime: '09:00' }],
    ['half day over full day', { halfDayMinutes: 500 }],
    ['overtime before full day', { overtimeAfterMins: 400 }],
    ['negative grace', { graceMinutes: -1 }],
    ['every day off', { weeklyOffDays: [0, 1, 2, 3, 4, 5, 6] }],
  ])('rejects %s', async (_label, over) => {
    const { agent } = await admin();
    expect((await agent.post('/api/shifts').send(shift(over))).status).toBe(400);
  });

  it('accepts an overnight shift, where the end is earlier in the day than the start', async () => {
    const { agent } = await admin();
    const res = await agent.post('/api/shifts').send(shift({ name: 'Night', startTime: '22:00', endTime: '06:00' }));
    expect(res.status).toBe(201);
    expect(res.body.shift).toMatchObject({ startTime: '22:00', endTime: '06:00' });
  });

  it('refuses to delete a shift that still has employees', async () => {
    const { agent } = await admin();
    const { body } = await agent.post('/api/shifts').send(shift());
    await agent.post('/api/users').send(newUser({ shiftId: body.shift.id }));
    expect((await agent.delete(`/api/shifts/${body.shift.id}`)).status).toBe(409);
  });
});
