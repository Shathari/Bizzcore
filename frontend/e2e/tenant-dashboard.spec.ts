import { test, expect } from "@playwright/test";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Reuses the session saved by auth.setup.ts instead of logging in via the
// UI per test — avoids tripping the login rate limiter across a full
// suite run, and is far faster.
test.use({ storageState: path.join(__dirname, ".auth", "tenant-admin.json") });

test.describe("tenant dashboard", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL("http://localhost:5173/");
  });

  test("Home shows stat cards and a revenue chart", async ({ page }) => {
    await expect(page.getByText("Today's Inquiries")).toBeVisible();
    await expect(page.locator(".recharts-responsive-container")).toBeVisible();
  });

  test("Customers: add, find via search, then delete", async ({ page }) => {
    await page.getByRole("link", { name: "Customers" }).click();
    await expect(page).toHaveURL(/\/customers$/);

    await page.getByRole("button", { name: "+ Add Customer" }).click();
    await page.locator("label:has-text('Name *') + input").fill("E2E Test Customer");
    await page.locator("label:has-text('Phone *') + input").fill("+919876500001");
    await page.getByRole("button", { name: "Add Customer", exact: true }).click();
    await expect(page.getByText("E2E Test Customer")).toBeVisible();

    await page.locator("input[placeholder*='Search']").fill("E2E Test Customer");
    await expect(page.locator("tbody tr")).toHaveCount(1);

    await page.getByLabel("Delete E2E Test Customer").click();
    await page.getByRole("button", { name: "Delete", exact: true }).click();
    await expect(page.getByText("E2E Test Customer")).toHaveCount(0);
  });

  test("Communication: seeded conversations are visible and repliable", async ({ page }) => {
    await page.getByRole("link", { name: "Communication" }).click();
    await expect(page).toHaveURL(/\/communication$/);
    await expect(page.getByText("Inbox")).toBeVisible();

    // Click a seeded conversation by contact name rather than by position —
    // "aside + div button" would also match the TopBar's Sign Out button,
    // since it's a descendant of the same layout wrapper div.
    await page.getByText("Ritu Kapoor").click();
    const replyText = `E2E reply ${Date.now()}`;
    await page.locator("input[placeholder='Type a reply…']").fill(replyText);
    await page.locator("form button[type=submit]").click();
    // Scoped to the message thread, not page.getByText(replyText) directly
    // — a sent reply also becomes the conversation list's preview text
    // (same string rendered twice: thread bubble + sidebar item), which
    // trips Playwright's strict mode on an unscoped locator.
    const messageThread = page.locator("div.flex-1.overflow-y-auto.px-5.py-4");
    await expect(messageThread.getByText(replyText)).toBeVisible();
  });

  test("Website: only Super-Admin-mapped modules appear, and Products shows seeded items", async ({ page }) => {
    await page.getByRole("link", { name: "Website" }).click();
    await expect(page).toHaveURL(/\/website$/);
    await page.getByRole("button", { name: "Products", exact: true }).click();
    await expect(page.getByText("Kanjivaram Silk").first()).toBeVisible();
    // Testimonials/Blogs/FAQs/Contact Details aren't mapped for the seeded
    // demo tenant — the tab bar should only ever show mapped features.
    await expect(page.getByRole("button", { name: "Testimonials", exact: true })).toHaveCount(0);
  });

  test("Social Media: mock-mode banner is visible with no Meta credentials configured", async ({ page }) => {
    await page.getByRole("link", { name: "Social Media" }).click();
    await expect(page).toHaveURL(/\/social-media$/);
    await expect(page.getByText("isn't connected for this business yet")).toBeVisible();
  });

  test("AI Assistant: shows not-configured banner and disables Generate when unset", async ({ page }) => {
    await page.getByRole("link", { name: "AI Assistant" }).click();
    await expect(page).toHaveURL(/\/ai-assistant$/);
    await expect(page.getByText("AI Assistant isn't configured yet")).toBeVisible();
    await expect(page.getByRole("button", { name: "Generate" })).toBeDisabled();
  });

  test("Settings: both integrations start Not connected", async ({ page }) => {
    await page.getByRole("link", { name: "Settings" }).click();
    await expect(page).toHaveURL(/\/settings$/);
    await expect(page.getByText("Not connected")).toHaveCount(2);
  });

  test("sidebar covers every tenant module with no dead links", async ({ page }) => {
    for (const label of ["Home", "Customers", "Communication", "Website", "Social Media", "AI Assistant", "Settings"]) {
      await page.getByRole("link", { name: label, exact: true }).click();
      await expect(page.locator("main")).not.toContainText("Cannot GET");
    }
  });

  test("a Business Admin (ADMIN role) cannot reach Super Admin's Website Integration pages", async ({ page }) => {
    // /super-admin itself, and everything nested under it (including
    // businesses/:id, where the Website Integration config panel lives),
    // is wrapped in a single RequireAuth role="SUPER_ADMIN" guard — an
    // ADMIN session should bounce off the parent route before any child
    // route, including BusinessDetail's integration panel, ever renders.
    await page.goto("/super-admin");
    await expect(page).toHaveURL("http://localhost:5173/");
    await expect(page.getByText("Control Tower")).not.toBeVisible();

    await page.goto("/super-admin/businesses/some-tenant-id");
    await expect(page).toHaveURL("http://localhost:5173/");
    await expect(page.getByText("Integration config")).not.toBeVisible();
    await expect(page.getByText("Website content & integrations")).not.toBeVisible();

    await page.goto("/super-admin/audit-log");
    await expect(page).toHaveURL("http://localhost:5173/");
  });
});
