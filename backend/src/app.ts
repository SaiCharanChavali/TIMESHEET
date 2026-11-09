import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { type NextFunction, type Request, type Response } from 'express';
import helmet from 'helmet';
import { ZodError } from 'zod';
import { Prisma } from './generated/prisma/client.js';
import { env } from './lib/env.js';
import { HttpError } from './lib/errors.js';
import { approvalsRouter } from './routes/approvals.js';
import { attendanceRouter } from './routes/attendance.js';
import { authRouter } from './routes/auth.js';
import { departmentsRouter } from './routes/departments.js';
import { forgottenCheckoutsRouter } from './routes/forgottenCheckouts.js';
import { holidaysRouter } from './routes/holidays.js';
import { notificationsRouter } from './routes/notifications.js';
import { shiftsRouter } from './routes/shifts.js';
import { usersRouter } from './routes/users.js';

export const app = express();

app.use(helmet());
app.use(cors({ origin: env.CLIENT_URL, credentials: true }));
app.use(express.json({ limit: '100kb' }));
app.use(cookieParser());

app.use('/api/auth', authRouter);
app.use('/api/users', usersRouter);
app.use('/api/departments', departmentsRouter);
app.use('/api/shifts', shiftsRouter);
app.use('/api/holidays', holidaysRouter);
app.use('/api/attendance', attendanceRouter);
app.use('/api/forgotten-checkouts', forgottenCheckoutsRouter);
app.use('/api/notifications', notificationsRouter);
app.use('/api', approvalsRouter);

app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof ZodError) {
    res.status(400).json({ error: err.issues[0]?.message ?? 'Invalid request' });
    return;
  }
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  // Safety nets for what the services' own checks can't catch, such as two admins saving at the same moment.
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2025') {
      res.status(404).json({ error: 'That record no longer exists' });
      return;
    }
    if (err.code === 'P2002' || err.code === 'P2003') {
      res.status(409).json({ error: 'This conflicts with an existing record. Refresh and try again.' });
      return;
    }
  }
  // Malformed JSON and oversized bodies come from body-parser with their own 4xx status.
  const status = (err as { status?: number }).status;
  if (status && status >= 400 && status < 500) {
    res.status(status).json({ error: 'Invalid request' });
    return;
  }
  console.error(err);
  res.status(500).json({ error: 'Something went wrong' });
});
