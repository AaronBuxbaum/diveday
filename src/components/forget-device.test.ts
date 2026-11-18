import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/ready-offline", () => ({ forgetReadyPageCopy: vi.fn(async () => true) }));
vi.mock("@/lib/offline-manifest-store", () => ({
  wipeOfflineMedicalAlerts: vi.fn(async () => {}),
}));

const { forgetReadyPageCopy } = await import("@/lib/ready-offline");
const { wipeOfflineMedicalAlerts } = await import("@/lib/offline-manifest-store");
const { forgetThisDevice } = await import("./forget-device");
const { deviceCleanupMayBeIncomplete } = await import("./forget-device");

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
    await forgetThisDevice();
    expect(forgetReadyPageCopy).toHaveBeenCalledTimes(1);
  });

  it("reports an incomplete wipe without stopping sign-out", async () => {
    vi.stubGlobal("indexedDB", {});
    vi.mocked(wipeOfflineMedicalAlerts).mockRejectedValueOnce(new Error("unavailable"));
    await expect(forgetThisDevice()).resolves.toEqual({ status: "incomplete" });
  });

  it("records a warning when IndexedDB is unavailable", async () => {
    const values = new Map<string, string>();
    vi.stubGlobal("sessionStorage", {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    });
    vi.stubGlobal("indexedDB", undefined);
    await expect(forgetThisDevice()).resolves.toEqual({ status: "incomplete" });
    expect(deviceCleanupMayBeIncomplete()).toBe(true);
  });

  it("reports incomplete if the wipe does not finish before sign-out continues", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("indexedDB", {});
    vi.mocked(wipeOfflineMedicalAlerts).mockReturnValueOnce(new Promise<void>(() => {}));
    const result = forgetThisDevice();
    await vi.advanceTimersByTimeAsync(2_000);
    await expect(result).resolves.toEqual({ status: "incomplete" });
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
