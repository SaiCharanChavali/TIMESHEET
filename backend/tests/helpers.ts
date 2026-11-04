import request from 'supertest';
import { app } from '../src/app.js';
import { Role } from '../src/generated/prisma/client.js';
import { db } from '../src/lib/db.js';
import { hashPassword } from '../src/services/auth.js';

// These tests wipe tables, so refuse to run against anything but the test database.
if (!process.env.DATABASE_URL?.endsWith('/timesheet_test')) {
  throw new Error('Run the tests with `npm test`, not vitest directly.');
}

export const PASSWORD = 'correct-horse-1';
const hash = await hashPassword(PASSWORD);

export async function makeUser(code: string, role: Role, managerId?: string) {
  return db.user.create({
    data: { employeeCode: code, name: code, email: `${code}@test.local`.toLowerCase(), role, passwordHash: hash, managerId },
  });
}

export async function loginAs(email: string, password = PASSWORD) {
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/login').send({ email, password });
  return { agent, res };
}

export async function resetDb() {
  await db.passwordResetToken.deleteMany();
  await db.user.deleteMany();
  await db.department.deleteMany();
  await db.shift.deleteMany();
  await db.holiday.deleteMany();
}
