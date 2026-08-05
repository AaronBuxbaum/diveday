import { chromium } from "@playwright/test";
const OUT = "/tmp/claude-0/-home-user-diveday/6f92d0d8-c878-57cb-986b-afd262b84c06/scratchpad/shots";
const EXE = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const targets = [
  ["/", "crop-home-records", "Your records come in clean, and leave the same way."],
  ["/about", "crop-about-hero", "Small enough to answer you. Built so nothing rests on one person."],
  ["/about", "crop-about-facts", "Who you're actually buying from."],
  ["/switching", "crop-hub", "The door swings both ways."],
  ["/switching/eve", "crop-eve-bothways", "The same table, read the other way."],
  ["/switching/spreadsheet", "crop-sheet-bothways", "The same table, read the other way."],
];
const browser = await chromium.launch({ executablePath: EXE });
for (const scheme of ["light", "dark"]) {
  const ctx = await browser.newContext({ colorScheme: scheme, viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  for (const [path, name, heading] of targets) {
    await page.goto("http://localhost:3000" + path, { waitUntil: "domcontentloaded", timeout: 60000 });
    const h = page.getByRole("heading", { name: heading }).first();
    await h.waitFor({ timeout: 20000 });
    // Shoot the whole section the heading sits in, so the surrounding copy shows.
    const section = h.locator("xpath=ancestor::section[1]");
    const target = (await section.count()) ? section.first() : h;
    await target.scrollIntoViewIfNeeded(); await page.waitForTimeout(500); const box = await target.boundingBox(); await page.screenshot({ path: `${OUT}/${name}-${scheme}.png`, animations: "disabled", clip: { x: box.x, y: box.y, width: box.width, height: Math.min(box.height, 1400) }, fullPage: true });
    console.log(`${scheme} ${name} shot`);
  }
  await ctx.close();
}
await browser.close();
