import { test, expect, type Page } from "@playwright/test";

async function setup(page: Page, role: string) {
  const sales: Array<Record<string, unknown>> = [];
  const customer = { id: "customer-1", name: "Asha", phoneMasked: "+9198••••••88", totalSpent: 100, lastPurchase: null };
  const campaigns = [
    { id: "campaign-1", title: "New arrivals", sentAt: "2026-10-05T10:00:00Z", offerEnabled: false, offerEligible: false, offerCode: null, offerDescription: null },
    { id: "campaign-2", title: "Festive collection", sentAt: "2026-10-05T10:00:00Z", offerEnabled: true, offerEligible: true, offerCode: "FESTIVE10", offerDescription: "In-store offer" },
  ];
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname; let data: unknown;
    if (!path.startsWith("/api/")) { await route.continue(); return; }
    if (path === "/api/auth/me") data = { id: "staff-1", name: "Staff", email: "staff@example.com", role, tenantId: "tenant-1", mustChangePassword: false, businessName: "Test store" };
    else if (path === "/api/customers") data = [{ ...customer, segment: "Regular", consentStatus: "OPTED_OUT", createdAt: "2026-10-01T00:00:00Z" }];
    else if (path === "/api/customer-categories") data = [];
    else if (path === "/api/purchases/customer-lookup") { expect(route.request().method()).toBe("POST"); expect(new URL(route.request().url()).search).toBe(""); data = { customers: [customer] }; }
    else if (path === "/api/purchases/customers/customer-1/campaigns") { const input = route.request().postDataJSON(); data = { campaigns: input.offerCode ? campaigns.filter((c) => c.offerCode === input.offerCode) : campaigns }; }
    else if (path === "/api/purchases/customers/customer-1") data = { customer, purchaseCount: sales.length, purchases: sales.map((sale, i) => ({ id: `sale-${i}`, amount: sale.amount, purchasedAt: "2026-10-06T10:00:00Z", broadcast: sale.broadcastId ? { id: sale.broadcastId, title: "Selected campaign" } : null, offerRedemption: sale.redeemOffer ? { offerCode: "FESTIVE10", redeemedAt: "2026-10-06T10:00:00Z" } : null })) };
    else if (path === "/api/purchases") { sales.push(route.request().postDataJSON()); data = { purchase: { id: "sale-1" }, replayed: false }; }
    else { await route.fulfill({ status: 404, json: { error: "No mock route" } }); return; }
    await route.fulfill({ json: data });
  });
  await page.goto("/dashboard/customers");
  if (role === "ADMIN") await page.getByRole("button", { name: "Record Sale", exact: true }).click();
  await page.getByLabel("Customer phone number").fill("+919800000088"); await page.getByRole("button", { name: "Find customer", exact: true }).click();
  await expect(page.getByLabel("WhatsApp campaign / offer (optional)")).toBeEnabled();
  return sales;
}

// Exercise the shared ADMIN and EMPLOYEE SaleEntry.
for (const role of ["EMPLOYEE", "ADMIN"]) {
  test(`${role} confirms campaign attribution through the shared sale workflow`, async ({ page }) => {
    const sales = await setup(page, role);
    await page.getByLabel("WhatsApp campaign / offer (optional)").selectOption("campaign-1");
    await page.getByLabel("Sale amount (₹)").fill("500"); await page.getByRole("button", { name: "Save sale", exact: true }).click();
    await expect(page.getByText("Sale recorded.", { exact: true })).toBeVisible(); expect(sales[0]).toMatchObject({ broadcastId: "campaign-1", redeemOffer: false, amount: 500 });
    if (role === "EMPLOYEE") { await expect(page.getByRole("link", { name: "Communication", exact: true })).toHaveCount(0); await expect(page.getByRole("button", { name: "+ New Broadcast", exact: true })).toHaveCount(0); }
  });
}
test("employee selects a normalized offer code and explicitly redeems it", async ({ page }) => {
  const sales = await setup(page, "EMPLOYEE"); await page.getByLabel("Offer code (optional)").fill(" festive10 "); await page.getByRole("button", { name: "Find offer", exact: true }).click();
  await expect(page.getByLabel("Offer redeemed in store")).toBeChecked(); await page.getByLabel("Sale amount (₹)").fill("750"); await page.getByRole("button", { name: "Save sale", exact: true }).click();
  await expect(page.getByText("Sale recorded.", { exact: true })).toBeVisible(); expect(sales[0]).toMatchObject({ broadcastId: "campaign-2", redeemOffer: true, offerCode: "FESTIVE10" });
});
test("employee records a walk-in even when candidate campaigns exist", async ({ page }) => {
  const sales = await setup(page, "EMPLOYEE"); await expect(page.getByLabel("WhatsApp campaign / offer (optional)")).toHaveValue("");
  await page.getByLabel("Sale amount (₹)").fill("100"); await page.getByRole("button", { name: "Save sale", exact: true }).click();
  await expect(page.getByText("Sale recorded.", { exact: true })).toBeVisible(); expect(sales[0]).not.toHaveProperty("broadcastId"); expect(sales[0]).not.toHaveProperty("redeemOffer");
});
test("an invalid offer lookup clears earlier redemption confirmation", async ({ page }) => {
  await setup(page, "EMPLOYEE"); await page.getByLabel("Offer code (optional)").fill("FESTIVE10"); await page.getByRole("button", { name: "Find offer", exact: true }).click();
  await expect(page.getByLabel("Offer redeemed in store")).toBeChecked();
  await page.getByLabel("Offer code (optional)").fill("WRONG"); await page.getByRole("button", { name: "Find offer", exact: true }).click();
  await expect(page.getByText("No eligible campaign offer found for this customer and date.", { exact: true })).toBeVisible();
  await expect(page.getByLabel("WhatsApp campaign / offer (optional)")).toHaveValue(""); await expect(page.getByLabel("Offer redeemed in store")).toHaveCount(0);
});
