import { afterEach, describe, expect, it, vi } from "vitest";

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
  afterEach(() => {
    vi.useRealTimers();
  });

  it("takes any kept /ready copy off the device", async () => {
    await forgetThisDevice();
    expect(forgetReadyPageCopy).toHaveBeenCalledTimes(1);
  });

  /** A stuck worker or cache never keeps a staffer signed in (security review 2, L4). */
  it("goes on after two seconds when the /ready wipe hangs", async () => {
    vi.useFakeTimers();
    vi.mocked(forgetReadyPageCopy).mockReturnValueOnce(new Promise<boolean>(() => {}));
    let done = false;
    const signingOut = forgetThisDevice().then(() => {
      done = true;
    });
    await vi.advanceTimersByTimeAsync(1_999);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await signingOut;
    expect(done).toBe(true);
  });
});
