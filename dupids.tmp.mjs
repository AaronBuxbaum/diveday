import { chromium } from "@playwright/test";
const base = process.env.BASE ?? "http://localhost:3200";
const target = process.env.TARGET ?? "/shop/blue-mantis/gear/4a5d9b2f-13ec-4ba9-af68-b09b7ab43404";
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(`${base}/sign-in`);
await page.getByLabel("Email").fill("dana@demo.invalid");
await page.getByLabel("Password").fill("password");
await page.getByRole("button", { name: /sign in/i }).click();
await page.waitForURL(/\/shop/, { timeout: 30000 });
await page.goto(base + target);
await page.waitForLoadState("networkidle");
const info = await page.evaluate(() => {
  const labels = [...document.querySelectorAll("label[for]")].map((l) => ({
    for: l.getAttribute("for"),
    text: l.textContent?.trim().slice(0, 40),
    target: document.getElementById(l.getAttribute("for"))?.tagName ?? "MISSING",
  }));
  const counts = {};
  for (const el of document.querySelectorAll("[id]")) counts[el.id] = (counts[el.id] ?? 0) + 1;
  return { labels, dupes: Object.entries(counts).filter(([, c]) => c > 1), cards: [...document.querySelectorAll("h2,h3")].map((h) => h.textContent?.trim().slice(0, 30)) };
});
console.log(JSON.stringify(info, null, 1));
await browser.close();
