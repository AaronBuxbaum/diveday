import { expect, vi } from "vitest";
import { DB_TEST_TIMEOUT_MS, needsDatabaseTimeout } from "./db-timeout";

if (typeof window !== "undefined") {
  await import("@testing-library/jest-dom/vitest");
  // jsdom has no layout, so it ships no `scrollIntoView` at all — calling it
  // is a TypeError, not a no-op. Any component that moves the cursor to a
  // refusal (`FieldErrorFocus`, `SiteFormShell`) would therefore throw inside
  // an effect and unmount itself, and the test would report the *absence of
  // the whole form* rather than the missing DOM API. A no-op stub keeps that
  // failure mode from ever being diagnosed twice.
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = function scrollIntoView() {};
  }
}

// A db-backed file gets a ceiling sized for a PGlite hydration rather than
// for pure logic; the reasoning is in `./db-timeout.ts`. This file runs once
// per test file, which is what makes a per-file answer possible at all.
if (needsDatabaseTimeout(expect.getState().testPath)) {
  vi.setConfig({ testTimeout: DB_TEST_TIMEOUT_MS, hookTimeout: DB_TEST_TIMEOUT_MS });
}
