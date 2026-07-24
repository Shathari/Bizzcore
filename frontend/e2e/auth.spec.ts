import { test, expect } from "@playwright/test";

test.describe("auth flow", () => {
  test("unauthenticated visit redirects to /login", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/login$/);
  });

  test("tenant admin login redirects to / with a welcome toast", async ({ page }) => {
    await page.goto("/login");
    await page.locator("#email").fill("owner@kalerisaree.com");
    await page.locator("#password").fill("Kaleri@123");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL("http://localhost:5173/");
    await expect(page.getByRole("status")).toContainText("Welcome back to Kaleri Saree");
  });

  test("freshly-provisioned admin is forced through password change before reaching the dashboard", async ({ page }) => {
    await page.goto("/login");
    await page.locator("#email").fill("owner@rangolithreads.com");
    await page.locator("#password").fill("Rangoli@Temp123");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/change-password$/);

    await page.locator("#currentPassword").fill("Rangoli@Temp123");
    await page.locator("#newPassword").fill("E2ENewPass1234");
    await page.locator("#confirmPassword").fill("E2ENewPass1234");
    await page.getByRole("button", { name: /Set new password/ }).click();
    await expect(page).toHaveURL("http://localhost:5173/");

    // Re-login with the new password should go straight through, not be
    // forced again.
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/login$/);
    await page.locator("#email").fill("owner@rangolithreads.com");
    await page.locator("#password").fill("E2ENewPass1234");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL("http://localhost:5173/");
  });

  test("super admin login redirects to the control tower, not the tenant dashboard", async ({ page }) => {
    await page.goto("/login");
    await page.locator("#email").fill("platform-admin@kalericonsole.com");
    await page.locator("#password").fill("SuperAdmin@123");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/super-admin$/);
    await expect(page.getByText("Control Tower")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Businesses" })).toBeVisible();
  });

  test("direct navigation to /super-admin while logged out redirects to /login", async ({ page }) => {
    await page.goto("/super-admin");
    await expect(page).toHaveURL(/\/login$/);
  });

  test("wrong password shows an inline error, not a redirect", async ({ page }) => {
    await page.goto("/login");
    await page.locator("#email").fill("owner@kalerisaree.com");
    await page.locator("#password").fill("wrong-password");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByRole("alert")).toBeVisible();
    await expect(page).toHaveURL(/\/login$/);
  });
});
