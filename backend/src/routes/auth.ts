import { Router } from 'express';
import { ipKeyGenerator, rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import type { User } from '../generated/prisma/client.js';
import { clearSessionCookie, requireSession, setSessionCookie } from '../middleware/auth.js';
import * as auth from '../services/auth.js';

export const authRouter = Router();

const limits = {
  windowMs: 15 * 60 * 1000,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Please try again in a few minutes.' },
};

// An office usually shares one public IP, so successful logins must never count against it.
// Failures are limited per account, which stops one person's typos from locking out their colleagues.
const accountLoginLimiter = rateLimit({
  ...limits,
  limit: 10,
  skipSuccessfulRequests: true,
  keyGenerator: (req) => {
    const email = typeof req.body?.email === 'string' ? req.body.email.toLowerCase() : '';
    return `${ipKeyGenerator(req.ip ?? '')}|${email}`;
  },
});

// The higher per-IP cap catches one source guessing passwords across many accounts.
const ipLoginLimiter = rateLimit({ ...limits, limit: 200, skipSuccessfulRequests: true });

const passwordResetLimiter = rateLimit({ ...limits, limit: 30 });

const newPassword = z.string().min(8, 'Password must be at least 8 characters').max(72, 'Password must be at most 72 characters');

const toPublicUser = ({ id, employeeCode, name, email, role, mustChangePassword }: User) =>
  ({ id, employeeCode, name, email, role, mustChangePassword });

authRouter.post('/login', ipLoginLimiter, accountLoginLimiter, async (req, res) => {
  const { email, password } = z.object({ email: z.email(), password: z.string().min(1) }).parse(req.body);
  const user = await auth.authenticate(email, password);
  setSessionCookie(res, user);
  res.json({ user: toPublicUser(user) });
});

authRouter.post('/logout', (_req, res) => {
  clearSessionCookie(res);
  res.status(204).end();
});

authRouter.get('/me', requireSession, (req, res) => {
  res.json({ user: toPublicUser(req.user) });
});

authRouter.post('/change-password', requireSession, async (req, res) => {
  const body = z.object({ currentPassword: z.string().min(1), newPassword }).parse(req.body);
  const user = await auth.changePassword(req.user.id, body.currentPassword, body.newPassword);
  setSessionCookie(res, user);
  res.status(204).end();
});

authRouter.post('/forgot-password', passwordResetLimiter, async (req, res) => {
  const { email } = z.object({ email: z.email() }).parse(req.body);
  await auth.requestPasswordReset(email);
  // Same response either way, so this can't be used to find out who has an account.
  res.json({ message: 'If that email has an account, a reset link has been sent.' });
});

authRouter.post('/reset-password', passwordResetLimiter, async (req, res) => {
  const body = z.object({ token: z.string().min(1), newPassword }).parse(req.body);
  await auth.resetPassword(body.token, body.newPassword);
  res.status(204).end();
});
