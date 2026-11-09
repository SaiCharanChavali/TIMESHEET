import { runForgottenCheckoutJob } from '../services/forgottenCheckout.js';
import type { Job } from './runner.js';

export const forgottenCheckoutJob: Job = {
  name: 'forgotten-checkouts',
  leaseMinutes: 10,
  run: (now) => runForgottenCheckoutJob(now),
};

export const allJobs = [forgottenCheckoutJob];
