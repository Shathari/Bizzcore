import { test, expect } from "@playwright/test";
import path from "path";
import { fileURLToPath } from "url";
import { createTestBusiness } from "./helpers";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

test.use({ storageState: path.join(__dirname, ".auth", "super-admin.json") });

// Drives the Website Integrations config UI itself (WebsiteIntegrationsPanel)
// end-to-end — previously this had zero e2e coverage; only the Business
// Admin's read-only content view was exercised. Every test here configures
// a Products integration against the backend's own mock external site
// (routes/mockExternalSite.ts, mounted at /api/mock-external-site — a real,
// unauthenticated stand-in third-party API, not a further mock inside the
// test), so "Analyze Endpoint" and "Test" genuinely round-trip through the
// backend against a real HTTP response, not a stubbed one.
const MOCK_PRODUCTS_URL = "http://localhost:4000/api/mock-external-site/products";

// Advanced's collapsible content only ever contains field-mapping <select>s
// (Response path is text inputs) — scoping to the wrapper div that directly
// contains the "Advanced" toggle button reliably isolates them from the
// per-method auth-type <select>s in the Methods section above it.
function advancedPanel(page: import("@playwright/test").Page) {
  return page.locator("div:has(> button:has-text('Advanced'))").first();
}

test.describe("super admin — website integrations config", () => {
  test("Analyze Endpoint discovers real fields, Test confirms connectivity, and a saved field mapping persists after reload", async ({ page }) => {
    await createTestBusiness(page);

    await page.getByRole("button", { name: "Configure Products integration" }).click();
    // Exact match — "Website base URL" (the Business details form, still
    // mounted underneath the modal overlay) also contains "Base URL".
    await expect(page.locator("label:text-is('Base URL')")).toBeVisible();

    await page.locator("label:text-is('Base URL') + input").fill(MOCK_PRODUCTS_URL);

    // Scoped to the dialog and exact-matched — "Test" is a substring of
    // the underlying panel's "Configure Testimonials integration" button,
    // which is still in the DOM (just behind the modal overlay). GET is
    // always the first method row, so its Test button is the first exact
    // "Test" match inside the dialog — a real connectivity check against
    // the mock site's real GET handler.
    await page.getByRole("dialog").getByRole("button", { name: "Test", exact: true }).first().click();
    await expect(page.getByText(/Reachable/)).toBeVisible();

    await page.getByRole("button", { name: "Advanced" }).click();
    await page.getByRole("button", { name: "Analyze Endpoint" }).click();
    // Button relabels to "Refresh Schema" once discoveredFields is
    // populated — the clearest signal Analyze actually succeeded.
    await expect(page.getByRole("button", { name: "Refresh Schema" })).toBeVisible();

    await page.getByRole("button", { name: "+ Add mapping" }).click();
    const panel = advancedPanel(page);
    const selects = panel.locator("select");
    // Dashboard field (Products has no "collection" field of its own —
    // "Collection" maps the dashboard's "collectionName" to the mock
    // site's "collection", a genuine rename, not an identity mapping).
    await selects.nth(0).selectOption({ label: "Collection" });
    // External field — populated from the real Analyze response above.
    await expect(selects.nth(1).locator("option", { hasText: "collection (string)" })).toHaveCount(1);
    await selects.nth(1).selectOption({ label: "collection (string)" });

    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByRole("dialog")).not.toBeVisible();

    // The panel's own post-save reload already re-fetches from the
    // backend (not an optimistic client-side update) — the row now shows
    // the saved base URL instead of "Not configured".
    await expect(page.getByText(MOCK_PRODUCTS_URL)).toBeVisible();

    // Full page reload — a fresh mount, fresh fetch — to prove the mapping
    // survived in the database, not just in this session's component state.
    await page.reload();
    await page.getByRole("button", { name: "View Products integration" }).click();
    await page.getByRole("button", { name: "Advanced" }).click();
    await expect(page.getByText("collectionName → collection")).toBeVisible();
  });

  test("saving Base URL and Business Admin permission level (Manage) persists", async ({ page }) => {
    await createTestBusiness(page);

    await page.getByRole("button", { name: "Configure Products integration" }).click();
    await page.locator("label:text-is('Base URL') + input").fill(MOCK_PRODUCTS_URL);
    await page.getByRole("button", { name: "Manage", exact: true }).click();
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByRole("dialog")).not.toBeVisible();

    await expect(page.getByText(MOCK_PRODUCTS_URL)).toBeVisible();
    await expect(page.getByText("Manage", { exact: true })).toBeVisible();
  });

  test("Schema history records each Analyze/Refresh and shows past field snapshots", async ({ page }) => {
    await createTestBusiness(page);

    await page.getByRole("button", { name: "Configure Products integration" }).click();
    await page.locator("label:text-is('Base URL') + input").fill(MOCK_PRODUCTS_URL);
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByRole("dialog")).not.toBeVisible();

    // Reopen an already-configured integration — from here on, Analyze
    // calls actually persist a history snapshot (discoverAndStoreSchema
    // only appends to history once a WebsiteIntegration row exists; the
    // very first Analyze, before the initial Save above, is a "test before
    // save" that intentionally doesn't persist anything).
    await page.getByRole("button", { name: "View Products integration" }).click();
    await page.getByRole("button", { name: "Edit configuration" }).click();
    await page.getByRole("button", { name: "Advanced" }).click();

    await page.getByRole("button", { name: "Analyze Endpoint" }).click();
    await expect(page.getByRole("button", { name: "Refresh Schema" })).toBeVisible();
    await page.getByRole("button", { name: "Refresh Schema" }).click();
    // Still relabeled "Refresh Schema" after the second call completes —
    // wait for the "Analyzing…" transient state to clear.
    await expect(page.getByRole("button", { name: "Analyzing…" })).not.toBeVisible();

    await page.getByRole("button", { name: "Schema history" }).click();
    await expect(page.getByText(/\d+ fields/)).toHaveCount(2);

    // Expand one entry and confirm its field list actually renders — a
    // field the mock Products data genuinely has, not a stale placeholder.
    await page.getByText(/\d+ fields/).first().click();
    await expect(page.getByText("price (number)")).toBeVisible();
  });
});
