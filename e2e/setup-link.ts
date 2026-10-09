import type { Page } from "@playwright/test";

/**
 * A fresh, open setup link's path (`/onboard?setup=<token>`), minted through
 * `/api/test/seed-setup-link` (ADR 20261009-single-use-setup-links). A link
 * opens one shop, so a spec that onboards mints one per shop, the way each
 * set-up request gets its own; a spec about the public door goes to
 * `/onboard` bare.
 *
 * Minted on the page's own request context, which carries the harness's
 * bearer header like every other test-route call.
 */
export async function mintOnboardFormPath(page: Page): Promise<string> {
  const response = await page.request.post("/api/test/seed-setup-link");
  if (!response.ok()) throw new Error(`seed-setup-link answered ${response.status()}`);
  const { path } = (await response.json()) as { path: string };
  return path;
}
