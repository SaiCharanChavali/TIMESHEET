import { Router } from 'express';
import { z } from 'zod';
import { Role } from '../generated/prisma/client.js';
import { db } from '../lib/db.js';
import { HttpError } from '../lib/errors.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import * as users from '../services/users.js';

export const usersRouter = Router();

usersRouter.use(requireAuth);

const optionalId = z.uuid().nullable();
const userFields = z.object({
  employeeCode: z.string().trim().min(1, 'Employee code is required').max(30).toUpperCase(),
  name: z.string().trim().min(1, 'Name is required').max(120),
  email: z.email('Enter a valid email address').max(254).toLowerCase(),
  role: z.enum(Role),
  departmentId: optionalId,
  shiftId: optionalId,
  managerId: optionalId,
});

async function assertReferencesExist(body: { departmentId?: string | null; shiftId?: string | null }) {
  if (body.departmentId && !(await db.department.findUnique({ where: { id: body.departmentId } }))) {
    throw new HttpError(400, 'That department no longer exists');
  }
  if (body.shiftId && !(await db.shift.findUnique({ where: { id: body.shiftId } }))) {
    throw new HttpError(400, 'That shift no longer exists');
  }
}

// Admins see everyone; managers see only their direct reports.
usersRouter.get('/', requireRole(Role.ADMIN, Role.MANAGER), async (req, res) => {
  const list = await db.user.findMany({
    where: req.user.role === Role.ADMIN ? {} : { managerId: req.user.id },
    orderBy: { employeeCode: 'asc' },
    select: {
      id: true, employeeCode: true, name: true, email: true, role: true, active: true,
      departmentId: true, shiftId: true, managerId: true,
      department: { select: { name: true } },
      shift: { select: { name: true } },
      manager: { select: { name: true } },
    },
  });
  res.json({ users: list });
});

usersRouter.post('/', requireRole(Role.ADMIN), async (req, res) => {
  const body = userFields.parse(req.body);
  await assertReferencesExist(body);
  res.set('Cache-Control', 'no-store').status(201).json(await users.createUser(body));
});

usersRouter.patch('/:id', requireRole(Role.ADMIN), async (req, res) => {
  const body = userFields.partial().extend({ active: z.boolean().optional() }).parse(req.body);
  await assertReferencesExist(body);
  await users.updateUser(req.user, String(req.params.id), body);
  res.status(204).end();
});

usersRouter.post('/:id/temporary-password', requireRole(Role.ADMIN), async (req, res) => {
  res.set('Cache-Control', 'no-store').json(await users.issueTemporaryPassword(req.user, String(req.params.id)));
});
