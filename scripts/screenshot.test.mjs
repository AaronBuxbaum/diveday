import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The one thing about this script a unit test can hold, and the exact bug that
 * broke it.
 *
 * `page.waitForFunction`'s predicate is serialized and run **inside the page**,
 * where this module's `const`s do not exist. Written as
 * `waitForFunction(() => !document.querySelector(SKELETON_SELECTOR))` it threw
 * `ReferenceError: SKELETON_SELECTOR is not defined` on every route — and the
 * catch around it turned that into "the page never finished streaming", which
 * sends the reader to the dev server's log instead of to the line that is
 * wrong. Every capture the tool took failed, and the message said the app was
 * at fault.
 *
 * The script is a CLI that runs on import, so it cannot be imported and its
 * predicate cannot be called; the honest thing a test can check is that the
 * selector is still handed across the boundary rather than closed over.
 */
describe("the skeleton wait", () => {
  const source = readFileSync(path.join(process.cwd(), "scripts/screenshot.mjs"), "utf8");
  // Bounded to this one call. The file has a second `waitForFunction` whose
  // predicate genuinely takes no argument — it reads `document.title`, a
  // browser global that exists on the far side — and that one is correct.
  const start = source.indexOf("page.waitForFunction(");
  const call = source.slice(start, source.indexOf("});", start) + 3);

  it("takes the selector as an argument, because the predicate runs in the page", () => {
    // A zero-argument predicate here could only be reading a binding that does
    // not exist on the other side of the boundary.
    expect(call).not.toMatch(/waitForFunction\(\s*\(\)\s*=>/);
    expect(call).toMatch(/waitForFunction\(\s*\(\w+\)\s*=>/);
  });

  it("still passes the selector this module defines", () => {
    // Guards the other half: an inlined literal here would drift from the
    // documented `SKELETON_SELECTOR` without anything noticing.
    expect(call).toContain("SKELETON_SELECTOR");
  });
});

/**
 * The second thing a source scan can hold: the session is minted once and
 * replayed, and a refusal is waited for by name.
 *
 * The script used to submit the sign-in form in every (scheme × viewport)
 * context — four times a run — and wait only for `/shop`. Against a dev
 * server with the real limiter on (8 sign-ins per email per 15 minutes) the
 * second run of an afternoon was refused, landed on `/sign-in?error=1`, and
 * each context sat there until Playwright's navigation timeout with nothing
 * printed. Sessions read that as "rate-limited, wait it out", and waited.
 */
describe("the staff sign-in", () => {
  const source = readFileSync(path.join(process.cwd(), "scripts/screenshot.mjs"), "utf8");

  it("submits the form once per run and hands the session to every context as storage state", () => {
    expect(source.match(/getByRole\("button", \{ name: "Sign in" \}\)/g)).toHaveLength(1);
    // The capture contexts take the minted session rather than earning their own.
    const captureContext = source.slice(source.indexOf("reducedMotion:"));
    expect(captureContext).toMatch(/storageState,/);
  });

  it("waits for the refusal landing as well as the shop, so a refused sign-in says so", () => {
    const start = source.indexOf("async function signInOnce");
    const body = source.slice(start, source.indexOf("\n}\n", start));
    // Success and refusal are the two places the action can redirect to; a
    // wait that only knows the first turns the second into a silent timeout.
    expect(body).toMatch(/url\.pathname\.startsWith\("\/shop"\)/);
    expect(body).toMatch(/url\.searchParams\.has\("error"\)/);
    expect(body).toContain("DIVEDAY_RATE_LIMIT_DISABLED=1");
  });
});
