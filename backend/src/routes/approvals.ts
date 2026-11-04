import { Router } from 'express';
import { z } from 'zod';
import { Role } from '../generated/prisma/client.js';
import { dayString } from '../lib/validation.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import * as approvals from '../services/approvals.js';

export const approvalsRouter = Router();

approvalsRouter.use(requireAuth);

const reviewers = requireRole(Role.ADMIN, Role.MANAGER);
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Enter times as HH:mm');
const note = z.object({ note: z.string().trim().min(3, 'Please give a reason').max(500) });
const month = z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Enter a valid month') });

approvalsRouter.get('/approvals', reviewers, async (req, res) => {
  res.json(await approvals.getApprovals(req.user));
});

approvalsRouter.get('/corrections/mine', async (req, res) => {
  res.json(await approvals.myCorrections(req.user));
});

approvalsRouter.post('/corrections', async (req, res) => {
  const body = z.object({
    date: dayString,
    checkIn: time,
    checkOut: time,
    breakMinutes: z.number().int().min(0).max(1440),
    reason: z.string().trim().min(3, 'Please give a reason').max(500),
  }).parse(req.body);
  await approvals.createCorrection(req.user, body);
  res.status(201).end();
});

approvalsRouter.delete('/corrections/:id', async (req, res) => {
  await approvals.cancelCorrection(req.user, String(req.params.id));
  res.status(204).end();
});

approvalsRouter.post('/corrections/:id/approve', reviewers, async (req, res) => {
  await approvals.approveCorrection(req.user, String(req.params.id));
  res.status(204).end();
});

approvalsRouter.post('/corrections/:id/reject', reviewers, async (req, res) => {
  await approvals.rejectCorrection(req.user, String(req.params.id), note.parse(req.body).note);
  res.status(204).end();
});

approvalsRouter.post('/timesheets/submit', async (req, res) => {
  await approvals.submitTimesheet(req.user, month.parse(req.body).month);
  res.status(204).end();
});

approvalsRouter.post('/timesheets/withdraw', async (req, res) => {
  await approvals.withdrawTimesheet(req.user, month.parse(req.body).month);
  res.status(204).end();
});

approvalsRouter.post('/timesheets/:id/approve', reviewers, async (req, res) => {
  await approvals.approveTimesheet(req.user, String(req.params.id));
  res.status(204).end();
});

approvalsRouter.post('/timesheets/:id/reject', reviewers, async (req, res) => {
  await approvals.rejectTimesheet(req.user, String(req.params.id), note.parse(req.body).note);
  res.status(204).end();
});

approvalsRouter.post('/timesheets/:id/reopen', requireRole(Role.ADMIN), async (req, res) => {
  await approvals.reopenTimesheet(req.user, String(req.params.id), note.parse(req.body).note);
  res.status(204).end();
});
