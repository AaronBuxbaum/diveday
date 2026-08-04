import { expect, test } from "./fixtures";

/**
 * TEMPORARY DIAGNOSTIC — delete with `src/app/api/test/diagnose-og/route.ts`
 * and `scripts/diagnose-og-sharp.mjs` once the recap OG-image failure is fixed.
 *
 * This asserts almost nothing on purpose: its job is to print what the server
 * process sees into the CI log, next to the failure it explains. The one thing
 * it does assert is that the probe route answered at all, so a silently
 * unreachable probe reads as a failure rather than as an empty result.
 *
 * It also fetches the real OG URL alongside the probe, so a single log line
 * shows both halves of the contradiction we are chasing: the render working
 * in-process while the same render served over HTTP tears the socket down.
 */
test("TEMPORARY: what the server process sees when rendering the recap OG card", async ({
  request,
}) => {
  const probe = await request.get("/api/test/diagnose-og");
  expect(probe.ok(), "the diagnostic route did not answer").toBe(true);
  const report = await probe.json();

  // The same request e2e/recap.spec.ts makes, from the same fleet, so the two
  // results are directly comparable. Never allowed to fail this test — the
  // whole point is to observe it, and recap.spec.ts is what holds the contract.
  let overHttp: string;
  try {
    const response = await request.get("/recap/not-a-real-token/opengraph-image");
    overHttp = `status=${response.status()} type=${response.headers()["content-type"]} bytes=${(await response.body()).length}`;
  } catch (error) {
    overHttp = `THREW: ${(error as Error).message}`;
  }

  console.log(`[diagnose-og] in-process: ${JSON.stringify(report)}`);
  console.log(`[diagnose-og] over HTTP:  ${overHttp}`);
});
