import "dotenv/config";
import { createApp } from "./app";
import { startScheduler } from "./jobs/scheduler";

const app = createApp();

startScheduler();

const port = Number(process.env.PORT ?? 4000);
app.listen(port, () => {
  console.log(`BizzCore API listening on port ${port}`);
});
