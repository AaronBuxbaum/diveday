import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/ready-offline", () => ({ forgetReadyPageCopy: vi.fn(async () => true) }));
vi.mock("@/lib/offline-manifest-store", () => ({
  wipeOfflineMedicalAlerts: vi.fn(async () => {}),
}));

const { forgetReadyPageCopy } = await import("@/lib/ready-offline");
const { wipeOfflineMedicalAlerts } = await import("@/lib/offline-manifest-store");
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
    vi.unstubAllGlobals();
  });

  it("takes any kept /ready copy off the device", async () => {
    vi.stubGlobal("indexedDB", {});
    expect(await forgetThisDevice()).toEqual({ offlineSensitiveCleanupReportedComplete: true });
    expect(forgetReadyPageCopy).toHaveBeenCalledTimes(1);
  });

  it("reports unavailable storage without claiming it was cleared", async () => {
    vi.stubGlobal("indexedDB", undefined);
    expect(await forgetThisDevice()).toEqual({ offlineSensitiveCleanupReportedComplete: false });
  });

  it("reports a failed ready-page cleanup", async () => {
    vi.stubGlobal("indexedDB", {});
    vi.mocked(forgetReadyPageCopy).mockResolvedValueOnce(false);
    expect(await forgetThisDevice()).toEqual({ offlineSensitiveCleanupReportedComplete: false });
  });

  it("reports incomplete cleanup on a failed manifest wipe", async () => {
    vi.stubGlobal("indexedDB", {});
    vi.mocked(wipeOfflineMedicalAlerts).mockRejectedValueOnce(new Error("unreadable"));
    expect(await forgetThisDevice()).toEqual({ offlineSensitiveCleanupReportedComplete: false });
  });

  /** A stuck worker or cache never keeps a staffer signed in (security review 2, L4). */
  it("goes on after two seconds when the /ready wipe hangs", async () => {
    vi.useFakeTimers();
    vi.mocked(forgetReadyPageCopy).mockReturnValueOnce(new Promise<boolean>(() => {}));
    let done = false;
    const signingOut = forgetThisDevice().then((result) => {
      done = true;
      return result;
    });
    await vi.advanceTimersByTimeAsync(1_999);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await signingOut).toEqual({ offlineSensitiveCleanupReportedComplete: false });
    expect(done).toBe(true);
  });
});
