import { Router } from 'express';
import { z } from 'zod';
import { Role } from '../generated/prisma/client.js';
import { db } from '../lib/db.js';
import { HttpError } from '../lib/errors.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

export const shiftsRouter = Router();

shiftsRouter.use(requireAuth, requireRole(Role.ADMIN));

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Enter times as HH:mm');
const minutes = z.number().int().min(0).max(1440);

const shiftFields = z.object({
  name: z.string().trim().min(1, 'Name is required').max(80),
  startTime: time,
  endTime: time,
  graceMinutes: minutes,
  fullDayMinutes: minutes,
  halfDayMinutes: minutes,
  overtimeAfterMins: minutes,
  weeklyOffDays: z.array(z.number().int().min(0).max(6)).max(6, 'At least one day must be a working day')
    .transform((days) => [...new Set(days)].sort()),
})
  // "HH:mm" strings sort chronologically, so plain comparison is correct here.
  .refine((s) => s.endTime > s.startTime, 'End time must be after start time. Overnight shifts are not supported yet.')
  .refine((s) => s.halfDayMinutes <= s.fullDayMinutes, 'Half-day minutes cannot be more than full-day minutes')
  .refine((s) => s.overtimeAfterMins >= s.fullDayMinutes, 'Overtime cannot start before a full day is complete');

async function assertNameFree(name: string, excludeId?: string) {
  const existing = await db.shift.findFirst({
    where: { name: { equals: name, mode: 'insensitive' }, ...(excludeId ? { id: { not: excludeId } } : {}) },
  });
  if (existing) throw new HttpError(409, 'A shift with this name already exists');
}

shiftsRouter.get('/', async (_req, res) => {
  const shifts = await db.shift.findMany({
    orderBy: { name: 'asc' },
    include: { _count: { select: { users: true } } },
  });
  res.json({ shifts });
});

shiftsRouter.post('/', async (req, res) => {
  const data = shiftFields.parse(req.body);
  await assertNameFree(data.name);
  res.status(201).json({ shift: await db.shift.create({ data }) });
});

shiftsRouter.put('/:id', async (req, res) => {
  const data = shiftFields.parse(req.body);
  await assertNameFree(data.name, String(req.params.id));
  res.json({ shift: await db.shift.update({ where: { id: String(req.params.id) }, data }) });
});

shiftsRouter.delete('/:id', async (req, res) => {
  const id = String(req.params.id);
  const count = await db.user.count({ where: { shiftId: id } });
  if (count) throw new HttpError(409, `This shift still has ${count} employee(s). Move them first.`);
  await db.shift.delete({ where: { id } });
  res.status(204).end();
});
