import { onTestFinished, vi } from "vitest";
import { nowMs } from "@/lib/clock";

/**
 * Moves the application clock forward for the rest of the current test. Every
 * test runs under one frozen `DIVEDAY_CLOCK`, and a `created_at` column takes
 * the app clock (issue #2538), so two rows a test writes in a row share an
 * instant. A test that reads "the latest" or "in the order written" calls this
 * between the writes; the frozen clock comes back when the test ends.
 */
export function advanceClock(ms = 1_000): void {
  vi.stubEnv("DIVEDAY_CLOCK", new Date(nowMs() + ms).toISOString());
  onTestFinished(() => {
    vi.unstubAllEnvs();
  });
}
