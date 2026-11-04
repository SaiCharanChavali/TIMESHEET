import type { CookieOptions, NextFunction, Request, Response } from 'express';
import type { Role, User } from '../generated/prisma/client.js';
import { db } from '../lib/db.js';
import { isProduction } from '../lib/env.js';
import { HttpError } from '../lib/errors.js';
import { SESSION_TTL_MS, signSession, verifySession } from '../services/auth.js';

declare global {
  namespace Express {
    interface Request {
      user: User;
    }
  }
}

const COOKIE_NAME = 'session';
const cookieOptions: CookieOptions = { httpOnly: true, sameSite: 'lax', secure: isProduction, path: '/' };

export function setSessionCookie(res: Response, user: { id: string; tokenVersion: number }) {
  res.cookie(COOKIE_NAME, signSession(user), { ...cookieOptions, maxAge: SESSION_TTL_MS });
}

export function clearSessionCookie(res: Response) {
  res.clearCookie(COOKIE_NAME, cookieOptions);
}

// Accepts users who still have a temporary password. Only for the routes they need in order to replace it.
export async function requireSession(req: Request, _res: Response, next: NextFunction) {
  const unauthorized = new HttpError(401, 'Please log in');
  const token = req.cookies?.[COOKIE_NAME];
  if (!token) throw unauthorized;

  let session;
  try {
    session = verifySession(token);
  } catch {
    throw unauthorized;
  }

  // Checked on every request so that deactivating a user or changing a password takes effect immediately.
  const user = await db.user.findUnique({ where: { id: session.userId } });
  if (!user || !user.active || user.tokenVersion !== session.tokenVersion) throw unauthorized;

  req.user = user;
  next();
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  await requireSession(req, res, () => {
    if (req.user.mustChangePassword) throw new HttpError(403, 'Please change your temporary password first');
    next();
  });
}

export const requireRole =(...roles: Role[]) => (req: Request, _res: Response, next: NextFunction) => {
  if (!roles.includes(req.user.role)) throw new HttpError(403, 'You do not have permission to do this');
  next();
};
