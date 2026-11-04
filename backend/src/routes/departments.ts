import { Router } from 'express';
import { z } from 'zod';
import { Role } from '../generated/prisma/client.js';
import { db } from '../lib/db.js';
import { HttpError } from '../lib/errors.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

export const departmentsRouter = Router();

departmentsRouter.use(requireAuth, requireRole(Role.ADMIN));

const parseBody = (body: unknown) =>
  z.object({ name: z.string().trim().min(1, 'Name is required').max(80) }).parse(body);

async function assertNameFree(name: string, excludeId?: string) {
  const existing = await db.department.findFirst({
    where: { name: { equals: name, mode: 'insensitive' }, ...(excludeId ? { id: { not: excludeId } } : {}) },
  });
  if (existing) throw new HttpError(409, 'A department with this name already exists');
}

departmentsRouter.get('/', async (_req, res) => {
  const departments = await db.department.findMany({
    orderBy: { name: 'asc' },
    include: { _count: { select: { users: true } } },
  });
  res.json({ departments });
});

departmentsRouter.post('/', async (req, res) => {
  const { name } = parseBody(req.body);
  await assertNameFree(name);
  res.status(201).json({ department: await db.department.create({ data: { name } }) });
});

departmentsRouter.put('/:id', async (req, res) => {
  const { name } = parseBody(req.body);
  await assertNameFree(name, String(req.params.id));
  res.json({ department: await db.department.update({ where: { id: String(req.params.id) }, data: { name } }) });
});

departmentsRouter.delete('/:id', async (req, res) => {
  const id = String(req.params.id);
  const count = await db.user.count({ where: { departmentId: id } });
  if (count) throw new HttpError(409, `This department still has ${count} employee(s). Move them first.`);
  await db.department.delete({ where: { id } });
  res.status(204).end();
});
