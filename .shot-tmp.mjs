import { chromium } from "@playwright/test";

const out = "/tmp/claude-0/-home-user-diveday/00d299da-f2d0-53c7-b225-1d366863197f/scratchpad";
const browser = await chromium.launch();

for (const scheme of ["light", "dark"]) {
  const ctx = await browser.newContext({
    colorScheme: scheme,
    viewport: { width: 900, height: 800 },
    deviceScaleFactor: 2,
  });
  const page = await ctx.newPage();
  await page.goto("http://localhost:3000/sign-in", { waitUntil: "networkidle", timeout: 120000 });
  await page.waitForTimeout(1500);

  // Tab to the first real control and report the computed outline.
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press("Tab");
    await page.waitForTimeout(250);
    const info = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return null;
      const cs = getComputedStyle(el);
      return {
        tag: el.tagName.toLowerCase(),
        name: (el.getAttribute("name") || el.textContent || "").trim().slice(0, 40),
        outlineColor: cs.outlineColor,
        outlineWidth: cs.outlineWidth,
        outlineStyle: cs.outlineStyle,
        offset: cs.outlineOffset,
      };
    });
    console.log(`[${scheme}] Tab ${i + 1}:`, JSON.stringify(info));
  }
  await page.screenshot({ path: `${out}/sign-in-focus-${scheme}.png`, fullPage: false });
  await ctx.close();
}

await browser.close();
