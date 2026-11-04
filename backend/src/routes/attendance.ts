import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { Role } from '../generated/prisma/client.js';
import { dayString } from '../lib/validation.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import * as attendance from '../services/attendance.js';

export const attendanceRouter = Router();

attendanceRouter.use(requireAuth);

attendanceRouter.get('/today', async (req, res) => {
  res.json(await attendance.getToday(req.user));
});

attendanceRouter.get('/recent', async (req, res) => {
  const { days } = z.object({ days: z.coerce.number().int().min(1).max(62).default(14) }).parse(req.query);
  res.json(await attendance.getRecentDays(req.user, days));
});

attendanceRouter.get('/timesheet', async (req, res) => {
  const { view, date, userId } = z.object({
    view: z.enum(['day', 'week', 'month']).default('month'),
    date: dayString.optional(),
    userId: z.uuid().optional(),
  }).parse(req.query);
  const user = await attendance.resolveViewableUser(req.user, userId);
  res.json(await attendance.getTimesheet(user, view, date));
});

attendanceRouter.get('/team', requireRole(Role.ADMIN, Role.MANAGER), async (req, res) => {
  const { date } = z.object({ date: dayString.optional() }).parse(req.query);
  res.json(await attendance.getTeamDay(req.user, date));
});

// Each action replies with the updated day, so the page never has to guess the new state.
const action = (run: (user: Request['user']) => Promise<unknown>) => async (req: Request, res: Response) => {
  await run(req.user);
  res.json(await attendance.getToday(req.user));
};

attendanceRouter.post('/check-in', action((user) => attendance.checkIn(user)));
attendanceRouter.post('/check-out', action((user) => attendance.checkOut(user)));
attendanceRouter.post('/break/start', action((user) => attendance.startBreak(user)));
attendanceRouter.post('/break/end', action((user) => attendance.endBreak(user)));
