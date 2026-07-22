import { test, expect } from "@playwright/test";
import path from "path";
import { fileURLToPath } from "url";
import { createTestBusiness } from "./helpers";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

test.use({ storageState: path.join(__dirname, ".auth", "super-admin.json") });

test.describe("super admin", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/super-admin");
    await expect(page).toHaveURL(/\/super-admin$/);
  });

  test("Businesses list shows both seeded tenants", async ({ page }) => {
    await expect(page.getByRole("link", { name: "Kaleri Saree", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Rangoli Threads", exact: true })).toBeVisible();
  });

  test("Add Business creates a tenant and shows the mock-mode credential fallback", async ({ page }) => {
    await page.getByRole("link", { name: "+ Add Business" }).click();
    const businessName = `E2E Boutique ${Date.now()}`;
    await page.locator("label:has-text('Business name') + input").fill(businessName);
    await page.locator("label:has-text('Owner name') + input").fill("E2E Owner");
    await page.locator("label:has-text('Owner email') + input").fill(`e2e-${Date.now()}@test.example`);
    await page.getByRole("button", { name: "Create business" }).click();

    // Both the toast and the inline success panel say "created"
    // simultaneously — that's correct UI behavior, so scope to the panel.
    await expect(page.locator("p.font-medium", { hasText: `${businessName} created` })).toBeVisible();
    await expect(page.getByText("Delivery didn't complete")).toBeVisible();
    await expect(page.getByText("Temporary password")).toBeVisible();
  });

  test("Suspend then reactivate a business toggles its status", async ({ page }) => {
    await expect(page.getByRole("link", { name: "Kaleri Saree", exact: true })).toBeVisible();
    const row = page.locator("tr", { has: page.getByText("Rangoli Threads") });
    await row.getByRole("button", { name: "Suspend" }).click();
    await expect(row.getByRole("button", { name: "Reactivate" })).toBeVisible();

    await row.getByRole("button", { name: "Reactivate" }).click();
    await expect(row.getByRole("button", { name: "Suspend" })).toBeVisible();
  });

  test("Audit Log records business creation", async ({ page }) => {
    await page.getByRole("link", { name: "Audit Log" }).click();
    await expect(page).toHaveURL(/\/audit-log$/);
    await expect(page.getByText("Business created").first()).toBeVisible();
  });

  test("editing business details, including Website base URL, persists after a reload", async ({ page }) => {
    await createTestBusiness(page);

    const newUrl = `https://updated-${Date.now()}.example.com`;
    const websiteField = page.locator("label:has-text('Website base URL') + input");
    await websiteField.fill(newUrl);
    await page.locator("label:has-text('Address') + textarea").fill("221B Baker Street");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("Business details saved")).toBeVisible();

    await page.reload();
    await expect(page.locator("label:has-text('Website base URL') + input")).toHaveValue(newUrl);
    await expect(page.locator("label:has-text('Address') + textarea")).toHaveValue("221B Baker Street");
  });

  test("two-step soft delete removes a business from the list and Restore brings it back", async ({ page }) => {
    const businessName = await createTestBusiness(page);

    await page.getByRole("button", { name: "Delete business…" }).click();
    await expect(page.getByText("This action is irreversible")).toBeVisible();
    // Soft delete is the pre-selected default — just continue.
    await page.getByRole("button", { name: "Continue" }).click();

    await page.getByPlaceholder(businessName).fill(businessName);
    const confirmButton = page.getByRole("button", { name: "Delete business", exact: true });
    await expect(confirmButton).toBeEnabled();
    await confirmButton.click();

    await expect(page).toHaveURL(/\/super-admin$/);
    await expect(page.getByText(`${businessName} deleted`)).toBeVisible();
    await expect(page.getByRole("link", { name: businessName, exact: true })).not.toBeVisible();

    await page.getByRole("button", { name: "Show deleted" }).click();
    const deletedRow = page.locator("tr", { has: page.getByText(businessName) });
    await expect(deletedRow).toBeVisible();
    await deletedRow.getByRole("button", { name: "Restore" }).click();
    await expect(page.getByText(`${businessName} restored`)).toBeVisible();

    await page.getByRole("button", { name: "Show active" }).click();
    await expect(page.getByRole("link", { name: businessName, exact: true })).toBeVisible();
  });

  test("Delete confirmation button stays disabled until the exact business name or DELETE is typed", async ({ page }) => {
    const businessName = await createTestBusiness(page);

    await page.getByRole("button", { name: "Delete business…" }).click();
    await page.getByRole("button", { name: "Continue" }).click();

    const confirmButton = page.getByRole("button", { name: "Delete business", exact: true });
    await expect(confirmButton).toBeDisabled();

    await page.getByPlaceholder(businessName).fill("not the right name");
    await expect(confirmButton).toBeDisabled();

    await page.getByPlaceholder(businessName).fill("DELETE");
    await expect(confirmButton).toBeEnabled();
  });
});
