import "dotenv/config";
import { logger } from "./lib/logger";
import { validateEnv } from "./lib/env";
import { createApp } from "./app";
import { startScheduler } from "./jobs/scheduler";

// Last-resort safety net for whatever express-async-errors + app.ts's own
// error-handling middleware can't catch — anything outside an Express
// request cycle entirely (a stray timer/cron callback, a Promise nobody
// awaited). Node's own guidance is that the process is in an undefined
// state after an uncaught exception, so this logs and exits rather than
// trying to keep running broken — Render's restart policy brings it back
// up clean, instead of the previous behavior of an uncontrolled crash with
// no log line explaining why.
process.on("uncaughtException", (err) => {
  logger.fatal({ err }, "uncaughtException — exiting");
  process.exit(1);
});
process.on("unhandledRejection", (reason) => {
  logger.fatal({ err: reason }, "unhandledRejection — exiting");
  process.exit(1);
});

validateEnv();

const app = createApp();

startScheduler();

const port = Number(process.env.PORT ?? 4000);
app.listen(port, () => {
  console.log(`BizzCore API listening on port ${port}`);
});
