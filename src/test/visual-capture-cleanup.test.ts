import type { Page } from "@playwright/test";
import { describe, expect, it } from "vitest";
import { withTransitionsOff } from "../../e2e/visual-harness";

describe("withTransitionsOff", () => {
  it("does not call back into the page after a capture fails", async () => {
    let cleanupCalls = 0;
    const page = {
      addStyleTag: async () => ({
        evaluate: async () => {
          cleanupCalls += 1;
        },
      }),
    };
    const captureError = new Error("font renderer-stalled");

    await expect(
      withTransitionsOff(page as unknown as Page, async () => {
        throw captureError;
      }),
    ).rejects.toBe(captureError);
    expect(cleanupCalls).toBe(0);
  });

  it("removes its temporary style after a successful capture", async () => {
    let cleanupCalls = 0;
    const page = {
      addStyleTag: async () => ({
        evaluate: async () => {
          cleanupCalls += 1;
        },
      }),
    };

    await expect(withTransitionsOff(page as unknown as Page, async () => "captured")).resolves.toBe(
      "captured",
    );
    expect(cleanupCalls).toBe(1);
  });
});
