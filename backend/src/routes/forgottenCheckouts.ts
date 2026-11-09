import { Router } from 'express';
import { z } from 'zod';
import { Role } from '../generated/prisma/client.js';
import { forgottenCheckoutJob } from '../jobs/index.js';
import { jobStatus, runJob } from '../jobs/runner.js';
import { dayString } from '../lib/validation.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import * as alerts from '../services/forgottenCheckout.js';
import { emailConfigured } from '../services/mailer.js';

export const forgottenCheckoutsRouter = Router();

forgottenCheckoutsRouter.use(requireAuth);

const reviewers = requireRole(Role.MANAGER, Role.HR, Role.ADMIN);
const minutes = (max: number) => z.number().int().min(0).max(max);

const settingsFields = z.object({
  enabled: z.boolean(),
  alertAfterMinutes: minutes(720),
  repeatReminders: z.boolean(),
  reminderIntervalMinutes: z.number().int().min(5, 'Reminders must be at least 5 minutes apart').max(720),
  maxReminders: z.number().int().min(1, 'Send at least one reminder').max(20),
  notifyEmployee: z.boolean(),
  notifyManager: z.boolean(),
  managerAfterMinutes: minutes(2880),
  notifyHr: z.boolean(),
  hrAfterMinutes: minutes(2880),
  sendEmail: z.boolean(),
})
  .refine((s) => s.managerAfterMinutes >= s.alertAfterMinutes, 'The manager cannot be told before the first alert')
  .refine((s) => s.hrAfterMinutes >= s.alertAfterMinutes, 'HR cannot be told before the first alert');

const noteBody = z.object({ note: z.string().trim().min(1, 'Please add a note').max(500) });
const idParam = (params: unknown) => z.object({ id: z.uuid() }).parse(params).id;

async function settingsResponse() {
  const [settings, job] = await Promise.all([alerts.getSettings(), jobStatus(forgottenCheckoutJob.name)]);
  return {
    settings,
    emailConfigured: emailConfigured(),
    job: job && { lastFinishedAt: job.lastFinishedAt, lastError: job.lastError, lastSummary: job.lastSummary },
  };
}

forgottenCheckoutsRouter.get('/settings', requireRole(Role.HR, Role.ADMIN), async (_req, res) => {
  res.json(await settingsResponse());
});

forgottenCheckoutsRouter.put('/settings', requireRole(Role.ADMIN), async (req, res) => {
  await alerts.updateSettings(req.user, settingsFields.parse(req.body));
  res.json(await settingsResponse());
});

// Runs the check straight away instead of waiting for the next scheduled run.
forgottenCheckoutsRouter.post('/run', requireRole(Role.ADMIN), async (_req, res) => {
  const result = await runJob(forgottenCheckoutJob);
  if (!result.ran) {
    res.status(409).json({ error: 'A check is already running. Try again in a minute.' });
    return;
  }
  res.json(result);
});

forgottenCheckoutsRouter.get('/', reviewers, async (req, res) => {
  const filters = z.object({
    status: z.enum(['open', 'resolved', 'all']).default('open'),
    from: dayString.optional(),
    to: dayString.optional(),
  }).parse(req.query);
  res.json(await alerts.listAlerts(req.user, filters));
});

forgottenCheckoutsRouter.get('/mine', async (req, res) => {
  res.json(await alerts.myAlerts(req.user));
});

forgottenCheckoutsRouter.post('/:id/explanation', async (req, res) => {
  const body = z.object({
    // Leaves room for the prefix it gets when copied into a correction reason, which allows 500.
    explanation: z.string().trim().min(1, 'Please say what happened').max(470),
    leftAt: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Enter times as HH:mm').optional(),
  }).parse(req.body);
  await alerts.submitExplanation(req.user, idParam(req.params), body);
  res.status(204).end();
});

forgottenCheckoutsRouter.post('/:id/remind', reviewers, async (req, res) => {
  await alerts.sendReminder(req.user, idParam(req.params));
  res.status(204).end();
});

forgottenCheckoutsRouter.post('/:id/escalate', reviewers, async (req, res) => {
  await alerts.escalateToHr(req.user, idParam(req.params), noteBody.parse(req.body).note);
  res.status(204).end();
});

forgottenCheckoutsRouter.post('/:id/resolve', reviewers, async (req, res) => {
  await alerts.closeAlert(req.user, idParam(req.params), noteBody.parse(req.body).note);
  res.status(204).end();
});
