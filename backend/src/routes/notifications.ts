import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import * as notifications from '../services/notifications.js';

export const notificationsRouter = Router();

notificationsRouter.use(requireAuth);

notificationsRouter.get('/', async (req, res) => {
  res.json(await notifications.listNotifications(req.user.id));
});

notificationsRouter.post('/read-all', async (req, res) => {
  await notifications.markAllRead(req.user.id);
  res.status(204).end();
});

notificationsRouter.post('/:id/read', async (req, res) => {
  const { id } = z.object({ id: z.uuid() }).parse(req.params);
  await notifications.markRead(req.user.id, id);
  res.status(204).end();
});
