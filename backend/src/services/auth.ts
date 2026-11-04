import { createHash, randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { db } from '../lib/db.js';
import { env } from '../lib/env.js';
import { HttpError } from '../lib/errors.js';
import { sendPasswordResetEmail } from './mailer.js';

const BCRYPT_ROUNDS = 12;
const RESET_TOKEN_TTL_MS = 60 * 60 * 1000;
// Long enough to cover a full shift plus overtime, so nobody is logged out before checking out.
export const SESSION_TTL_MS = 16 * 60 * 60 * 1000;

// Compared against when the email is unknown, so that response time doesn't reveal which emails exist.
const DUMMY_HASH = bcrypt.hashSync(randomBytes(16).toString('hex'), BCRYPT_ROUNDS);

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

export const hashPassword = (password: string) => bcrypt.hash(password, BCRYPT_ROUNDS);

export function signSession(user: { id: string; tokenVersion: number }) {
  return jwt.sign({ v: user.tokenVersion }, env.JWT_SECRET, {
    subject: user.id,
    expiresIn: Math.floor(SESSION_TTL_MS / 1000),
    algorithm: 'HS256',
  });
}

export function verifySession(token: string) {
  const payload = jwt.verify(token, env.JWT_SECRET, { algorithms: ['HS256'] }) as jwt.JwtPayload;
  return { userId: payload.sub as string, tokenVersion: payload.v as number };
}

export async function authenticate(email: string, password: string) {
  const user = await db.user.findUnique({ where: { email: email.toLowerCase() } });
  const valid = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !valid || !user.active) throw new HttpError(401, 'Incorrect email or password');
  return user;
}

export async function changePassword(userId: string, currentPassword: string, newPassword: string) {
  const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
  if (!(await bcrypt.compare(currentPassword, user.passwordHash))) {
    throw new HttpError(400, 'Current password is incorrect');
  }
  return db.user.update({
    where: { id: userId },
    data: { passwordHash: await hashPassword(newPassword), tokenVersion: { increment: 1 }, mustChangePassword: false },
  });
}

export async function requestPasswordReset(email: string) {
  const user = await db.user.findUnique({ where: { email: email.toLowerCase() } });
  if (!user || !user.active) return;

  const token = randomBytes(32).toString('hex');
  await db.$transaction([
    db.passwordResetToken.deleteMany({ where: { userId: user.id } }),
    db.passwordResetToken.create({
      data: { userId: user.id, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS) },
    }),
  ]);
  await sendPasswordResetEmail(user.email, token);
  return token;
}

export async function resetPassword(token: string, newPassword: string) {
  const passwordHash = await hashPassword(newPassword);
  const invalid = new HttpError(400, 'This reset link is invalid or has expired');

  await db.$transaction(async (tx) => {
    // The conditional update means that two simultaneous requests can't both use one token.
    const { count } = await tx.passwordResetToken.updateMany({
      where: { tokenHash: hashToken(token), usedAt: null, expiresAt: { gt: new Date() } },
      data: { usedAt: new Date() },
    });
    if (!count) throw invalid;

    const { userId } = await tx.passwordResetToken.findUniqueOrThrow({ where: { tokenHash: hashToken(token) } });
    await tx.user.update({
      where: { id: userId },
      data: { passwordHash, tokenVersion: { increment: 1 }, mustChangePassword: false },
    });
  });
}
