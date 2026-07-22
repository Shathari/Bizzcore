import { expect, type Page } from "@playwright/test";

// Shared across Super Admin e2e spec files so every test that needs a
// disposable business (one it can freely edit, map integrations to, and
// ultimately delete) uses the exact same creation flow — never a seeded
// tenant (Kaleri Saree / Rangoli Threads), since those are shared fixtures
// other tests depend on. Lives outside any *.spec.ts file: Playwright
// treats importing one spec file from another as re-registering its tests,
// which it rejects — this file has no `test(...)` calls, just a helper.
export async function createTestBusiness(page: Page): Promise<string> {
  await page.goto("/super-admin/new");
  const businessName = `E2E Mgmt Boutique ${Date.now()}`;
  await page.locator("label:has-text('Business name') + input").fill(businessName);
  await page.locator("label:has-text('Owner name') + input").fill("E2E Owner");
  await page.locator("label:has-text('Owner email') + input").fill(`e2e-mgmt-${Date.now()}@test.example`);
  await page.getByRole("button", { name: "Create business" }).click();
  await expect(page.locator("p.font-medium", { hasText: `${businessName} created` })).toBeVisible();
  await page.getByRole("link", { name: "View business" }).click();
  await expect(page.getByRole("heading", { name: businessName })).toBeVisible();
  return businessName;
}
