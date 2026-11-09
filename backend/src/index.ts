import { app } from './app.js';
import { allJobs } from './jobs/index.js';
import { startScheduler } from './jobs/runner.js';
import { env } from './lib/env.js';

app.listen(env.PORT, () => {
  console.log(`API listening on http://localhost:${env.PORT}`);
  startScheduler(allJobs);
});
