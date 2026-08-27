import { chromium } from "@playwright/test";
const base = process.env.BASE ?? "http://localhost:3410";
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(`${base}/sign-in`);
await page.getByLabel("Email").fill("dana@demo.invalid");
await page.getByLabel("Password").fill("password");
await page.getByRole("button", { name: /sign in/i }).click();
await page.waitForURL(/\/shop/, { timeout: 60000 });

const seeds = ["/shop/blue-mantis", "/shop/blue-mantis/schedule/board", "/shop/blue-mantis/divers",
  "/shop/blue-mantis/orders", "/shop/blue-mantis/dive-sites", "/shop/blue-mantis/courses",
  "/shop/blue-mantis/gear", "/shop/blue-mantis/settings", "/shop/blue-mantis/reviews",
  "/shop/blue-mantis/promos", "/shop/blue-mantis/requests", "/shop/blue-mantis/crew"];
const dynamic = new Set();
for (const s of seeds) {
  const r = await page.goto(`${base}${s}`, { waitUntil: "networkidle" });
  if (!r || r.status() >= 400) continue;
  for (const h of await page.locator("a[href^='/shop/blue-mantis/']").evaluateAll((els) =>
    els.map((e) => e.getAttribute("href")))) {
    if (h && /[0-9a-f]{8}-[0-9a-f]{4}-/.test(h)) dynamic.add(h.split("?")[0]);
  }
}
const list = [...dynamic];
console.log("dynamic staff routes found:", list.length);
let bad = 0, checked = 0;
for (const route of list) {
  const r = await page.goto(`${base}${route}`, { waitUntil: "networkidle" });
  if (!r || r.status() >= 400) continue;
  checked++;
  const dupes = await page.evaluate(() => {
    const counts = {};
    for (const el of document.querySelectorAll("[id]")) counts[el.id] = (counts[el.id] ?? 0) + 1;
    return Object.entries(counts).filter(([, c]) => c > 1).map(([id, c]) => ({ id, c,
      where: [...document.querySelectorAll(`[id="${CSS.escape(id)}"]`)].map((el) => {
        const l = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
        return `${el.tagName.toLowerCase()} label="${l?.textContent?.trim() ?? "-"}"`;
      }) }));
  });
  if (dupes.length) { bad++; console.log("DUPES", route, JSON.stringify(dupes)); }
}
console.log(`checked ${checked} dynamic staff routes, ${bad} with duplicate ids`);
await browser.close();
