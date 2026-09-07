import { expect, READ_ONLY, test } from "./fixtures";

/**
 * The public status page and the probe behind it (ADR
 * 20260907-external-uptime-monitor).
 *
 * `READ_ONLY` holds: both tests fetch and read, and neither writes a row.
 *
 * What is worth an e2e test here rather than a unit one is the part no unit
 * test can reach — that the page renders with no session at all, and that the
 * body the external monitor matches on is the body a real server actually
 * sends. The monitor's search string is asserted against the route's *source*
 * in `infra/lib/observability.test.ts`; this asserts it against the wire.
 */

test("the status page answers an anonymous reader, with no session and no shop", {
  tag: READ_ONLY,
}, async ({ page }) => {
  await page.goto("/status");

  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Everything is running.");

  // Both rows, each answering for itself. Scoped to the list rather than the
  // page: the headline says "running" too, and a page-wide text match would
  // count it and pass on a page that had lost the rows entirely. A degraded
  // render is unit-tested — taking the database away from a live worker would
  // take the fixture with it.
  const rows = page.getByRole("listitem").filter({ hasText: /^The / });
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toHaveText("The appRunning");
  await expect(rows.nth(1)).toHaveText("The databaseRunning");
  await expect(page.getByText(/^Last checked /)).toBeVisible();
});

test("the probe answers the literal the uptime check matches on", { tag: READ_ONLY }, async ({
  page,
}) => {
  const response = await page.request.get("/api/health");

  expect(response.status()).toBe(200);
  expect(response.headers()["cache-control"]).toBe("no-store");
  // `UPTIME_TARGETS[0].searchString`, on the wire. A rename that left the
  // Route 53 health check matching nothing would fail here first.
  expect(await response.text()).toContain('"status":"ok"');
});
