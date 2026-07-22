import { test as setup, expect } from "@playwright/test";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const tenantAdminState = path.join(__dirname, ".auth", "tenant-admin.json");
const superAdminState = path.join(__dirname, ".auth", "super-admin.json");

// Logs in once per role and saves the session cookie via storageState, so
// the rest of the suite reuses it instead of re-authenticating through the
// UI on every test — which would otherwise trip the (correctly working)
// login rate limiter once enough spec files run in the same session.
// auth.spec.ts is the one exception: it deliberately tests the login flow
// itself, so it logs in fresh rather than using these saved states.
setup("authenticate as tenant admin", async ({ page }) => {
  await page.goto("/login");
  await page.getByRole("button", { name: /Kaleri Saree \(Admin\)/ }).click();
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL("http://localhost:5173/");
  await page.context().storageState({ path: tenantAdminState });
});

setup("authenticate as super admin", async ({ page }) => {
  await page.goto("/login");
  await page.getByRole("button", { name: /Super Admin/ }).click();
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/super-admin$/);
  await page.context().storageState({ path: superAdminState });
});
