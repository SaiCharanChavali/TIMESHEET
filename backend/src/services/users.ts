import { randomInt } from 'node:crypto';
import { Role, type User } from '../generated/prisma/client.js';
import { db } from '../lib/db.js';
import { HttpError } from '../lib/errors.js';
import { hashPassword } from './auth.js';

export interface UserInput {
  employeeCode: string;
  name: string;
  email: string;
  role: Role;
  departmentId: string | null;
  shiftId: string | null;
  managerId: string | null;
}

// Leaves out characters that are easily confused when read aloud or copied by hand (0/O, 1/l/I).
const TEMP_PASSWORD_CHARS = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function generateTempPassword() {
  return Array.from({ length: 14 }, () => TEMP_PASSWORD_CHARS[randomInt(TEMP_PASSWORD_CHARS.length)]).join('');
}

async function assertUnique(fields: { email?: string; employeeCode?: string }, excludeId?: string) {
  const { email, employeeCode } = fields;
  const notSelf = excludeId ? { id: { not: excludeId } } : {};
  if (email && await db.user.findFirst({ where: { email, ...notSelf } })) {
    throw new HttpError(409, 'Another employee already uses this email');
  }
  if (employeeCode && await db.user.findFirst({ where: { employeeCode, ...notSelf } })) {
    throw new HttpError(409, 'Another employee already uses this employee code');
  }
}

async function assertValidManager(userId: string | null, managerId: string) {
  if (managerId === userId) throw new HttpError(400, 'An employee cannot be their own manager');

  const manager = await db.user.findUnique({ where: { id: managerId } });
  if (!manager || !manager.active || manager.role === Role.EMPLOYEE) {
    throw new HttpError(400, 'The manager must be an active manager or admin');
  }

  // Walk up the chain so that nobody ends up indirectly reporting to themselves.
  const seen = new Set<string>();
  for (let current = manager.managerId; current && !seen.has(current);) {
    if (current === userId) throw new HttpError(400, 'This manager already reports to this employee');
    seen.add(current);
    current = (await db.user.findUnique({ where: { id: current } }))?.managerId ?? null;
  }
}

async function assertNoActiveReports(user: User, action: string) {
  const count = await db.user.count({ where: { managerId: user.id, active: true } });
  if (count) throw new HttpError(409, `Move ${user.name}'s ${count} team member(s) to another manager before you ${action}`);
}

export async function createUser(input: UserInput) {
  await assertUnique(input);
  if (input.managerId) await assertValidManager(null, input.managerId);

  const temporaryPassword = generateTempPassword();
  const user = await db.user.create({
    data: { ...input, passwordHash: await hashPassword(temporaryPassword), mustChangePassword: true },
  });
  return { id: user.id, temporaryPassword };
}

export async function updateUser(actor: User, id: string, input: Partial<UserInput> & { active?: boolean }) {
  const target = await db.user.findUnique({ where: { id } });
  if (!target) throw new HttpError(404, 'Employee not found');

  // Blocking these on yourself also guarantees that at least one active admin always remains.
  if (actor.id === id && input.active === false) throw new HttpError(400, 'You cannot deactivate your own account');
  if (actor.id === id && input.role && input.role !== target.role) throw new HttpError(400, 'You cannot change your own role');

  const deactivating = input.active === false && target.active;
  if (deactivating) await assertNoActiveReports(target, 'deactivating them');
  if (input.role === Role.EMPLOYEE && target.role !== Role.EMPLOYEE) await assertNoActiveReports(target, 'changing their role');

  await assertUnique(input, id);
  if (input.managerId && input.managerId !== target.managerId) await assertValidManager(id, input.managerId);

  await db.user.update({
    where: { id },
    // Ending their sessions means reactivating them later doesn't bring old logins back to life.
    data: { ...input, ...(deactivating ? { tokenVersion: { increment: 1 } } : {}) },
  });
}

export async function issueTemporaryPassword(actor: User, id: string) {
  if (actor.id === id) throw new HttpError(400, 'Use the Account page to change your own password');
  const target = await db.user.findUnique({ where: { id } });
  if (!target) throw new HttpError(404, 'Employee not found');

  const temporaryPassword = generateTempPassword();
  await db.$transaction([
    db.passwordResetToken.deleteMany({ where: { userId: id } }),
    db.user.update({
      where: { id },
      data: { passwordHash: await hashPassword(temporaryPassword), mustChangePassword: true, tokenVersion: { increment: 1 } },
    }),
  ]);
  return { temporaryPassword };
}
