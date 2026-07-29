import { chromium } from "playwright";

const errors = [];
const browser = await chromium.launch({ args: ["--no-sandbox"] });
const page = await (await browser.newContext()).newPage();
page.on("console", (msg) => {
  if (msg.type() === "error") errors.push(msg.text());
});
page.on("pageerror", (err) => errors.push(String(err)));

await page.goto("http://localhost:5173", { waitUntil: "networkidle" });
await page.waitForSelector("text=BizzCore");
await page.screenshot({ path: "C:/Users/user/AppData/Local/Temp/claude/C--Users-user-ProjectNew/97167b7a-30db-413e-b198-11238256ef31/scratchpad/landing.png", fullPage: false });

await page.goto("http://localhost:5173/login", { waitUntil: "networkidle" }).catch(() => {});
await page.screenshot({ path: "C:/Users/user/AppData/Local/Temp/claude/C--Users-user-ProjectNew/97167b7a-30db-413e-b198-11238256ef31/scratchpad/login.png", fullPage: false });

console.log("ERRORS:", JSON.stringify(errors));
await browser.close();
