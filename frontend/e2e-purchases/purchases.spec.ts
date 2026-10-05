import { test, expect, type Page } from "@playwright/test";

async function setup(page: Page, role = "EMPLOYEE", failFirst = false) {
  const requests: Array<{ requestId: string; customerId: string; amount: number; purchasedAt?: string }> = [];
  let saved = false;
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    // Vite serves source modules under /src/api/ too; these are JavaScript,
    // not backend requests, and must reach the dev server unchanged.
    if (!path.startsWith("/api/")) { await route.continue(); return; }
    const customer = { id: "customer-1", name: "Asha", phoneMasked: "+9198••••••88", totalSpent: saved ? 225.5 : 100, lastPurchase: saved ? "2026-10-04T07:04:00.000Z" : null };
    let data: unknown;
    if (path === "/api/auth/me") data = { id: "employee-1", name: "Staff", email: "staff@example.com", role, tenantId: "tenant-1", mustChangePassword: false, businessName: "Test shop", logoUrl: null };
    else if (path === "/api/purchases/customer-lookup") {
      expect(route.request().method()).toBe("POST");
      expect(new URL(route.request().url()).search).toBe("");
      expect(route.request().postDataJSON()).toEqual({ phone: "+919800000088" });
      data = { customers: [customer], message: null };
    }
    else if (path === "/api/purchases/customers/customer-1") data = {
      customer, purchaseCount: saved ? 1 : 0, recordedTotalSpent: saved ? 125.5 : 0,
      purchases: saved ? [{ id: "purchase-1", amount: 125.5, purchasedAt: "2026-10-04T07:04:00.000Z" }] : [], historyLimited: false,
    };
    else if (path === "/api/purchases" && route.request().method() === "POST") {
      requests.push(route.request().postDataJSON()); saved = true;
      await new Promise((resolve) => setTimeout(resolve, 250));
      if (failFirst && requests.length === 1) {
        await route.fulfill({ status: 500, json: { error: "Temporary connection failure. Retry." } }); return;
      }
      data = { purchase: { id: "purchase-1", amount: 125.5 }, replayed: requests.length > 1 };
    } else if (path === "/api/customers") data = [{ ...customer, email: null, segment: "Regular", hasBirthday: false, notes: null, consentStatus: "UNKNOWN", createdAt: "2026-10-01T00:00:00.000Z" }];
    else if (path === "/api/customer-categories") data = [];
    else if (path.endsWith("/access-log")) data = [];
    else if (path === "/api/customers/customer-1") data = { ...customer, email: null, segment: "Regular", hasBirthday: false, notes: null, consentStatus: "UNKNOWN" };
    else { await route.fulfill({ status: 404, json: { error: "Test route not configured" } }); return; }
    await route.fulfill({ json: data });
  });
  return requests;
}
async function lookup(page: Page) {
  await page.goto("/dashboard/customers");
  await page.getByLabel("Customer phone number").fill("+919800000088");
  await page.getByRole("button", { name: "Find customer" }).click();
  await expect(page.getByLabel("Sale amount (₹)")).toBeVisible();
}

test("employee finds customer, records sale, and sees refreshed metrics/history", async ({ page }) => {
  const requests = await setup(page);
  await lookup(page);
  await page.getByLabel("Sale amount (₹)").fill("125.50");
  await page.getByLabel("Purchase date (optional)").fill("2026-10-04T12:34");
  await page.getByRole("button", { name: "Save sale" }).click();
  await expect(page.getByRole("button", { name: "Saving…" })).toBeDisabled();
  await expect(page.getByText("Sale recorded.", { exact: true })).toBeVisible();
  await expect(page.getByText(/Recorded purchases: 1/)).toBeVisible();
  expect(requests).toHaveLength(1);
  expect(requests[0]).toMatchObject({ customerId: "customer-1", amount: 125.5 });
  expect(requests[0].purchasedAt).toBeTruthy();
  expect(requests[0].requestId).toMatch(/^[0-9a-f-]{36}$/);
});

test("network retry retains the same request ID for the intended sale", async ({ page }) => {
  const requests = await setup(page, "EMPLOYEE", true);
  await lookup(page);
  await page.getByLabel("Sale amount (₹)").fill("125.50");
  await page.getByRole("button", { name: "Save sale" }).click();
  await expect(page.getByRole("alert")).toHaveText(/Temporary connection failure/);
  await page.getByRole("button", { name: "Save sale" }).click();
  await expect(page.getByText("Sale recorded.", { exact: true })).toBeVisible();
  expect(requests).toHaveLength(2);
  expect(requests[1]).toEqual(requests[0]);
});

test("employee navigation and direct URLs do not expose admin pages", async ({ page }) => {
  await setup(page);
  await page.goto("/dashboard/settings");
  await expect(page).toHaveURL(/\/dashboard\/customers$/);
  await expect(page.getByLabel("Customer phone number")).toBeVisible();
  await expect(page.getByRole("link", { name: "Settings", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Add Customer", exact: true })).toHaveCount(0);
});

test("admin records a sale inside the existing customer detail experience", async ({ page }) => {
  const requests = await setup(page, "ADMIN");
  await page.goto("/dashboard/customers");
  await page.getByRole("cell", { name: "Asha", exact: true }).click();
  await page.getByLabel("Sale amount (₹)").fill("125.50");
  await page.getByRole("button", { name: "Save sale" }).click();
  await expect(page.getByText(/Recorded purchases: 1/)).toBeVisible();
  expect(requests).toHaveLength(1);
});

test("an unknown phone displays a clear response without a sale form", async ({ page }) => {
  await setup(page);
  await page.route("**/api/purchases/customer-lookup", (route) => route.fulfill({ json: { customers: [], message: "No customer found for this phone number." } }));
  await page.goto("/dashboard/customers");
  await page.getByLabel("Customer phone number").fill("919900000099");
  await page.getByRole("button", { name: "Find customer" }).click();
  await expect(page.getByText("No customer found for this phone number.")).toBeVisible();
  await expect(page.getByLabel("Sale amount (₹)")).toHaveCount(0);
});

test("invalid sale amounts never submit a request", async ({ page }) => {
  const requests = await setup(page);
  await lookup(page);
  await page.getByLabel("Sale amount (₹)").fill("0");
  await page.getByRole("button", { name: "Save sale" }).click();
  expect(await page.getByLabel("Sale amount (₹)").evaluate((element: HTMLInputElement) => element.validity.valid)).toBe(false);
  expect(requests).toHaveLength(0);
});
