import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../src/app.js';
import { Role } from '../src/generated/prisma/client.js';
import { db } from '../src/lib/db.js';
import { requestPasswordReset } from '../src/services/auth.js';
import { loginAs, makeUser, PASSWORD, resetDb } from './helpers.js';

beforeEach(resetDb);

afterAll(async () => {
  await db.$disconnect();
});

describe('login', () => {
  it('logs in, sets an httpOnly cookie, and never returns the password hash', async () => {
    await makeUser('A1', Role.EMPLOYEE);
    const { agent, res } = await loginAs('a1@test.local');
    expect(res.status).toBe(200);
    expect(res.headers['set-cookie']?.[0]).toMatch(/HttpOnly/i);
    expect(JSON.stringify(res.body)).not.toContain('passwordHash');

    const me = await agent.get('/api/auth/me');
    expect(me.body.user.email).toBe('a1@test.local');
  });

  it('accepts email in any case', async () => {
    await makeUser('A2', Role.EMPLOYEE);
    expect((await loginAs('A2@TEST.LOCAL')).res.status).toBe(200);
  });

  it('gives the same error for a wrong password and an unknown email', async () => {
    await makeUser('A3', Role.EMPLOYEE);
    const wrong = (await loginAs('a3@test.local', 'nope')).res;
    const unknown = (await loginAs('ghost@test.local')).res;
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body).toEqual(unknown.body);
  });

  it('rejects deactivated users, including their existing sessions', async () => {
    const user = await makeUser('A4', Role.EMPLOYEE);
    const { agent } = await loginAs('a4@test.local');
    await db.user.update({ where: { id: user.id }, data: { active: false } });
    expect((await agent.get('/api/auth/me')).status).toBe(401);
    expect((await loginAs('a4@test.local')).res.status).toBe(401);
  });

  it('requires a session and rejects a tampered cookie', async () => {
    expect((await request(app).get('/api/auth/me')).status).toBe(401);
    const res = await request(app).get('/api/auth/me').set('Cookie', 'session=not.a.token');
    expect(res.status).toBe(401);
  });

  it('logout ends the session', async () => {
    await makeUser('A5', Role.EMPLOYEE);
    const { agent } = await loginAs('a5@test.local');
    await agent.post('/api/auth/logout');
    expect((await agent.get('/api/auth/me')).status).toBe(401);
  });

  it('returns 400 for malformed input instead of crashing', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: 'not-an-email' });
    expect(res.status).toBe(400);
    const badJson = await request(app).post('/api/auth/login').set('Content-Type', 'application/json').send('{oops');
    expect(badJson.status).toBe(400);
  });
});

describe('login rate limits', () => {
  it('blocks an account after repeated failures, even with the right password, without affecting colleagues', async () => {
    await makeUser('RL1', Role.EMPLOYEE);
    await makeUser('RL2', Role.EMPLOYEE);
    for (let i = 0; i < 10; i++) {
      expect((await loginAs('rl1@test.local', 'wrong')).res.status).toBe(401);
    }
    expect((await loginAs('rl1@test.local')).res.status).toBe(429);
    expect((await loginAs('RL1@TEST.LOCAL')).res.status).toBe(429);
    expect((await loginAs('rl2@test.local')).res.status).toBe(200);
  });

  it('lets a whole office log in from one IP address', async () => {
    const users = await Promise.all(Array.from({ length: 25 }, (_, i) => makeUser(`OFFICE${i}`, Role.EMPLOYEE)));
    const results = await Promise.all(users.map((u) => loginAs(u.email)));
    expect(results.map((r) => r.res.status)).toEqual(users.map(() => 200));
  });
});

describe('roles', () => {
  it('blocks employees from the user list', async () => {
    await makeUser('E1', Role.EMPLOYEE);
    const { agent } = await loginAs('e1@test.local');
    expect((await agent.get('/api/users')).status).toBe(403);
  });

  it('shows managers only their own reports', async () => {
    const m1 = await makeUser('M1', Role.MANAGER);
    const m2 = await makeUser('M2', Role.MANAGER);
    await makeUser('E2', Role.EMPLOYEE, m1.id);
    await makeUser('E3', Role.EMPLOYEE, m2.id);
    const { agent } = await loginAs('m1@test.local');
    const res = await agent.get('/api/users');
    expect(res.body.users.map((u: { employeeCode: string }) => u.employeeCode)).toEqual(['E2']);
  });

  it('shows admins everyone', async () => {
    await makeUser('X1', Role.ADMIN);
    await makeUser('E4', Role.EMPLOYEE);
    const { agent } = await loginAs('x1@test.local');
    expect((await agent.get('/api/users')).body.users).toHaveLength(2);
  });
});

describe('passwords', () => {
  it('changing a password keeps this session and ends the others', async () => {
    await makeUser('P1', Role.EMPLOYEE);
    const { agent } = await loginAs('p1@test.local');
    const { agent: otherDevice } = await loginAs('p1@test.local');

    const res = await agent.post('/api/auth/change-password').send({ currentPassword: PASSWORD, newPassword: 'new-password-1' });
    expect(res.status).toBe(204);
    expect((await agent.get('/api/auth/me')).status).toBe(200);
    expect((await otherDevice.get('/api/auth/me')).status).toBe(401);
    expect((await loginAs('p1@test.local', 'new-password-1')).res.status).toBe(200);
  });

  it('refuses a change when the current password is wrong', async () => {
    await makeUser('P2', Role.EMPLOYEE);
    const { agent } = await loginAs('p2@test.local');
    const res = await agent.post('/api/auth/change-password').send({ currentPassword: 'wrong', newPassword: 'new-password-1' });
    expect(res.status).toBe(400);
  });

  it('forgot-password responds identically for known and unknown emails', async () => {
    await makeUser('P3', Role.EMPLOYEE);
    const known = await request(app).post('/api/auth/forgot-password').send({ email: 'p3@test.local' });
    const unknown = await request(app).post('/api/auth/forgot-password').send({ email: 'ghost@test.local' });
    expect(known.status).toBe(200);
    expect(known.body).toEqual(unknown.body);
  });

  it('a reset token works once, stores only a hash, and ends existing sessions', async () => {
    await makeUser('P4', Role.EMPLOYEE);
    const { agent } = await loginAs('p4@test.local');
    const token = (await requestPasswordReset('p4@test.local'))!;
    expect((await db.passwordResetToken.findFirstOrThrow()).tokenHash).not.toBe(token);

    const body = { token, newPassword: 'reset-password-1' };
    expect((await request(app).post('/api/auth/reset-password').send(body)).status).toBe(204);
    expect((await request(app).post('/api/auth/reset-password').send(body)).status).toBe(400);
    expect((await agent.get('/api/auth/me')).status).toBe(401);
    expect((await loginAs('p4@test.local', 'reset-password-1')).res.status).toBe(200);
  });

  it('rejects an expired reset token', async () => {
    await makeUser('P5', Role.EMPLOYEE);
    const token = (await requestPasswordReset('p5@test.local'))!;
    await db.passwordResetToken.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    const res = await request(app).post('/api/auth/reset-password').send({ token, newPassword: 'reset-password-1' });
    expect(res.status).toBe(400);
  });
});
