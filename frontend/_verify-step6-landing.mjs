import { chromium } from "playwright";

const SCREENSHOT_DIR =
  "C:\\Users\\user\\AppData\\Local\\Temp\\claude\\C--Users-user-ProjectNew\\033313b3-93d6-410e-8416-dfacacd796e5\\scratchpad";

const browser = await chromium.launch();
const page = await browser.newPage();

// --- Unauthenticated visit to "/" shows the new public landing page ---
const consoleErrors = [];
page.on("console", (msg) => {
  if (msg.type() === "error") consoleErrors.push(msg.text());
});
await page.goto("http://localhost:5174/");
await page.waitForSelector("text=The operating system");
await page.screenshot({ path: `${SCREENSHOT_DIR}\\50-landing-page.png`, fullPage: true });

// Sign in directly from the landing page's embedded login box.
await page.fill('input[type="email"]', "owner@kalerisaree.com");
await page.fill('input[type="password"]', "Kaleri@123");
await Promise.all([page.waitForURL(/\/dashboard$/, { timeout: 10000 }), page.click('button:has-text("Sign in")')]);
console.log("post-login URL:", page.url());
await page.screenshot({ path: `${SCREENSHOT_DIR}\\51-dashboard-after-landing-signin.png`, fullPage: true });

// Sidebar nav now points at /dashboard/* — click Customers and confirm.
await page.click('a:has-text("Customers")');
await page.waitForURL(/\/dashboard\/customers$/, { timeout: 10000 });
console.log("customers URL:", page.url());

console.log("console errors:", consoleErrors);

// Fresh, unauthenticated context: an unknown path should bounce to the
// landing page, not a blank/broken route.
const freshCtx = await browser.newContext();
const freshPage = await freshCtx.newPage();
await freshPage.goto("http://localhost:5174/some-unknown-path-xyz");
await freshPage.waitForSelector("text=The operating system", { timeout: 10000 });
console.log("unauthenticated unknown-path redirect landed on:", freshPage.url());

// Authenticated tenant Admin hitting an unknown path should bounce to
// their dashboard, not the public landing page.
await freshPage.goto("http://localhost:5174/login");
await freshPage.fill('input[type="email"]', "owner@kalerisaree.com");
await freshPage.fill('input[type="password"]', "Kaleri@123");
await Promise.all([freshPage.waitForURL(/\/dashboard$/, { timeout: 10000 }), freshPage.click('button:has-text("Sign in")')]);
await freshPage.goto("http://localhost:5174/some-unknown-path-xyz");
await freshPage.waitForSelector("text=Priority follow-ups", { timeout: 10000 });
console.log("authenticated unknown-path redirect landed on:", freshPage.url());

await freshCtx.close();
await browser.close();
console.log("done");
