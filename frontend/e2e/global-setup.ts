import { execSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Runs once before webServer starts (Playwright's documented order:
// globalSetup → webServer → tests), so this is safe even though it
// touches the same dev.db the backend is about to serve from — nothing
// has opened it yet in this process tree.
export default function globalSetup() {
  const backendRoot = path.resolve(__dirname, "../../backend");
  execSync("npx prisma migrate reset --force", {
    cwd: backendRoot,
    stdio: "inherit",
  });
}
