import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/ready-offline", () => ({ forgetReadyPageCopy: vi.fn(async () => true) }));

const { forgetReadyPageCopy } = await import("@/lib/ready-offline");
const { forgetThisDevice } = await import("./forget-device");

/**
 * **A shop tablet keeps no diver's `/ready` page past a sign-out** (issue
 * #2693): the page is kept on any browser that opens the link, and a staffer
 * opening a diver's link on the counter tablet is the shared device it was
 * kept on.
 */
describe("forgetThisDevice", () => {
  it("takes any kept /ready copy off the device", async () => {
    await forgetThisDevice();
    expect(forgetReadyPageCopy).toHaveBeenCalledTimes(1);
  });
});
