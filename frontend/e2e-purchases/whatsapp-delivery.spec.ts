import { test, expect } from "@playwright/test";

test("broadcast UI separates Meta acceptance, delivery failure and physical attribution", async ({ page }) => {
  await page.route("**/api/**", async route => {
    const path = new URL(route.request().url()).pathname;
    if (!path.startsWith("/api/")) { await route.continue(); return; }
    let data: unknown = [];
    if (path === "/api/auth/me") data = { id: "admin", name: "Admin", email: "admin@example.com", role: "ADMIN", tenantId: "tenant", mustChangePassword: false, businessName: "Fixture" };
    if (path === "/api/communication/broadcasts") {
      data = [
        { id: "accepted", caption: "Accepted campaign", status: "published", sent: 1, failed: 0 },
        { id: "failed-delivery", caption: "Delivery failure campaign", status: "published", sent: 1, failed: 1 },
        { id: "partial", caption: "Partial campaign", status: "failed", sent: 1, failed: 0 },
        { id: "scheduled", caption: "Future campaign", status: "scheduled", sent: 0, failed: 0 },
      ].map(({ sent, failed, ...b }) => ({ ...b, scheduledAt: "2026-10-07T10:00:00Z", metrics: { sent, delivered: 0, read: 0, failed, physicalSales: 2, offerRedemptions: 1, attributedRevenue: 83.99 } }));
    }
    await route.fulfill({ json: data });
  });
  await page.goto("/dashboard/communication");
  await page.getByRole("button", { name: "Scheduled Broadcasts", exact: true }).click();
  const accepted = page.getByRole("row").filter({ hasText: "Accepted campaign" });
  await expect(accepted.getByText("Sent", { exact: true })).toBeVisible();
  await expect(accepted).toContainText("Sent / Accepted: 1");
  await expect(accepted).toContainText("Accepted by Meta; delivery is tracked separately.");
  const failed = page.getByRole("row").filter({ hasText: "Delivery failure campaign" });
  await expect(failed.getByText("Failed", { exact: true })).toBeVisible();
  await expect(failed).toContainText("Failed: 1"); await expect(failed).toContainText("Sent / Accepted: 1");
  await expect(failed).toContainText("Physical Sales: 2"); await expect(failed).toContainText("Offer Redemptions: 1"); await expect(failed).toContainText("83.99");
  await expect(page.getByRole("row").filter({ hasText: "Partial campaign" }).getByText("Partially Failed", { exact: true })).toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: "Future campaign" }).getByText("Scheduled", { exact: true })).toBeVisible();
  await expect(page.getByText("published", { exact: true })).toHaveCount(0);
});
