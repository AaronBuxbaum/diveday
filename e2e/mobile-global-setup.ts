import { webkit } from "@playwright/test";
import globalSetup from "./global-setup";
import { e2eBaseURL } from "./servers";

export default async function mobileGlobalSetup() {
  await globalSetup();
  // As with Chromium, absorb engine cold start outside a test's budget.
  const browser = await webkit.launch();
  try {
    const page = await browser.newPage();
    await page.goto(e2eBaseURL(0));
  } finally {
    await browser.close();
  }
}
