import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

vi.mock("@sentry/nextjs", () => ({ init: () => {}, captureRouterTransitionStart: () => {} }));

describe("instrumentation-client", () => {
  // Regression: zod's eval probe was the recurring `script-src` "eval" CSP
  // report on every staff page. See the comment in instrumentation-client.ts.
  it("stops zod from probing for eval before the first parse", async () => {
    await import("./instrumentation-client");
    const probe = vi.spyOn(globalThis, "Function");
    expect(z.object({ name: z.string() }).parse({ name: "Lena" })).toEqual({ name: "Lena" });
    expect(probe).not.toHaveBeenCalled();
    probe.mockRestore();
  });
});
