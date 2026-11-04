import { Router } from 'express';
import { z } from 'zod';
import { Role } from '../generated/prisma/client.js';
import { db } from '../lib/db.js';
import { HttpError } from '../lib/errors.js';
import { dayToDb, dbToDay } from '../lib/officeTime.js';
import { dayString } from '../lib/validation.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

export const holidaysRouter = Router();

holidaysRouter.use(requireAuth, requireRole(Role.ADMIN));

const serialize = (h: { id: string; date: Date; name: string }) => ({ id: h.id, name: h.name, date: dbToDay(h.date) });

holidaysRouter.get('/', async (_req, res) => {
  const holidays = await db.holiday.findMany({ orderBy: { date: 'asc' } });
  res.json({ holidays: holidays.map(serialize) });
});

holidaysRouter.post('/', async (req, res) => {
  const { date, name } = z.object({ date: dayString, name: z.string().trim().min(1, 'Name is required').max(80) }).parse(req.body);
  if (await db.holiday.findUnique({ where: { date: dayToDb(date) } })) {
    throw new HttpError(409, 'There is already a holiday on this date');
  }
  res.status(201).json({ holiday: serialize(await db.holiday.create({ data: { date: dayToDb(date), name } })) });
});

holidaysRouter.delete('/:id', async (req, res) => {
  await db.holiday.delete({ where: { id: String(req.params.id) } });
  res.status(204).end();
});
