import { test, expect, type Page } from "@playwright/test";

async function setup(page: Page, role = "ADMIN", needsLogin = false) {
  let loggedIn = !needsLogin; let forced = needsLogin; let saved = false;
  const employees: Array<{ id: string; name: string; email: string; createdAt: string; disabledAt: string | null }> = [];
  const sales: unknown[] = [];
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url()); const path = url.pathname;
    if (!path.startsWith("/api/")) { await route.continue(); return; }
    const method = route.request().method(); let data: unknown;
    const customer = { id: "customer-1", name: "Asha", phoneMasked: "+9198••••••88", totalSpent: saved ? 150 : 100, lastPurchase: saved ? "2026-10-04T00:00:00.000Z" : null };
    if (path === "/api/auth/me") {
      if (!loggedIn) { await route.fulfill({ status: 401, json: { error: "Not authenticated" } }); return; }
      data = { id: "user-1", name: "Staff", email: "staff@example.com", role, tenantId: "tenant-1", mustChangePassword: forced, businessName: "Test shop", logoUrl: null };
    } else if (path === "/api/auth/login") { loggedIn = true; data = { role, mustChangePassword: forced }; }
    else if (path === "/api/auth/change-password") { forced = false; data = { ok: true }; }
    else if (path === "/api/employees" && method === "POST") {
      const input = route.request().postDataJSON(); expect(Object.keys(input).sort()).toEqual(["email", "name", "temporaryPassword"]);
      const employee = { id: "employee-1", name: input.name, email: input.email, createdAt: "2026-10-05T00:00:00.000Z", disabledAt: null };
      employees.push(employee); data = employee;
    } else if (path.startsWith("/api/employees/") && method === "PATCH") { employees[0].disabledAt = route.request().postDataJSON().active ? null : "2026-10-05T00:00:00.000Z"; data = { ok: true }; }
    else if (path === "/api/employees") data = employees;
    else if (path === "/api/settings/integrations") data = { meta: { connected: false }, whatsapp: { connected: false } };
    else if (path === "/api/customer-categories") data = [];
    else if (path === "/api/customers") data = [{ ...customer, email: null, segment: "Regular", consentStatus: "UNKNOWN", createdAt: "2026-10-01T00:00:00.000Z" }];
    else if (path === "/api/purchases/customer-lookup") { expect(method).toBe("POST"); expect(url.search).toBe(""); data = { customers: [customer] }; }
    else if (path === "/api/purchases/customers/customer-1") data = { customer, purchaseCount: saved ? 1 : 0, purchases: saved ? [{ id: "sale-1", amount: 50, purchasedAt: "2026-10-04T00:00:00.000Z" }] : [] };
    else if (path === "/api/purchases") { saved = true; sales.push(route.request().postDataJSON()); data = { replayed: false, purchase: { id: "sale-1" } }; }
    else { await route.fulfill({ status: 404, json: { error: "Test route not configured" } }); return; }
    await route.fulfill({ json: data });
  });
  return sales;
}

test("admin provisions an employee and disables/reactivates their account in Settings", async ({ page }) => {
  await setup(page); await page.goto("/dashboard/settings");
  const panel = page.getByRole("region", { name: "Team / Employees" });
  await panel.getByRole("button", { name: "+ Add Employee", exact: true }).click();
  await page.getByLabel("Employee name").fill("Sales Staff"); await page.getByLabel("Employee email").fill("staff@example.com"); await page.getByLabel("Temporary password", { exact: true }).fill("Temporary123!");
  await page.getByRole("button", { name: "Create employee", exact: true }).click();
  await expect(panel.getByText("Sales Staff", { exact: true })).toBeVisible(); await expect(panel.getByText("ACTIVE", { exact: true })).toBeVisible();
  await panel.getByRole("button", { name: "Disable", exact: true }).click(); await expect(panel.getByText("DISABLED", { exact: true })).toBeVisible();
  await panel.getByRole("button", { name: "Reactivate", exact: true }).click(); await expect(panel.getByText("ACTIVE", { exact: true })).toBeVisible();
});
test("admin uses the visible Record Sale action with the shared phone lookup", async ({ page }) => {
  const sales = await setup(page); await page.goto("/dashboard/customers");
  await page.getByRole("button", { name: "Record Sale", exact: true }).click(); await page.getByLabel("Customer phone number").fill("+919800000088");
  await page.getByRole("button", { name: "Find customer" }).click(); await page.getByLabel("Sale amount (₹)").fill("50");
  await page.getByRole("button", { name: "Save sale" }).click(); await expect(page.getByText("Sale recorded.", { exact: true })).toBeVisible(); expect(sales).toHaveLength(1);
});
test("employee signs in, changes temporary password and reaches only the sales terminal", async ({ page }) => {
  await setup(page, "EMPLOYEE", true); await page.goto("/login"); await page.getByLabel("Email", { exact: true }).fill("staff@example.com"); await page.getByLabel("Password", { exact: true }).fill("Temporary123!");
  await page.getByRole("button", { name: "Sign in", exact: true }).click(); await expect(page).toHaveURL(/\/change-password$/);
  await page.getByLabel("Temporary password", { exact: true }).fill("Temporary123!"); await page.getByLabel("New password", { exact: true }).fill("Changed123!"); await page.getByLabel("Confirm new password").fill("Changed123!");
  await page.getByRole("button", { name: "Set new password & continue" }).click(); await expect(page).toHaveURL(/\/dashboard\/customers$/);
  await expect(page.getByRole("link", { name: "Record Sale", exact: true }).first()).toBeVisible(); await expect(page.getByRole("link", { name: "Settings", exact: true })).toHaveCount(0);
  await page.getByRole("link", { name: "Change Password", exact: true }).first().click(); await expect(page.getByLabel("Current password")).toBeVisible();
});
