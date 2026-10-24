import { afterEach, describe, expect, it, vi } from "vitest";
import { forgetReadyPageCopy, READY_CACHE_NAME, readyCopyKeepUntil } from "./ready-offline";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Security review of layer 8, D2: the phone's copy ends with the trip, not two weeks on. */
describe("readyCopyKeepUntil", () => {
  it("is a day after the boat is due back, or after it leaves when no return is set", () => {
    const startsAt = new Date("2026-10-20T13:00:00Z");
    const endsAt = new Date("2026-10-20T17:00:00Z");
    expect(readyCopyKeepUntil({ startsAt, endsAt })).toBe(endsAt.getTime() + DAY_MS);
    expect(readyCopyKeepUntil({ startsAt, endsAt: null })).toBe(startsAt.getTime() + DAY_MS);
  });
});

/**
 * **"Remove saved copy", and every staff sign-out** (issue #2693): the copy's
 * cache goes, and so does the diver's `/ready/` registration (first, so no
 * save lands after the delete), so nothing on this browser keeps the page
 * again until the link is next opened. The staff
 * worker at `/` is left alone: it holds the crew's offline manifests.
 */
describe("forgetReadyPageCopy", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("deletes the copy and unregisters the diver's worker, never the staff one", async () => {
    const deleted: string[] = [];
    const unregistered: string[] = [];
    const registration = (scope: string) => ({
      scope,
      unregister: async () => {
        unregistered.push(scope);
        return true;
      },
    });
    vi.stubGlobal("caches", {
      delete: async (name: string) => {
        deleted.push(name);
        return true;
      },
    });
    vi.stubGlobal("navigator", {
      serviceWorker: {
        getRegistrations: async () => [
          registration("https://dive.day/"),
          registration("https://dive.day/ready/"),
        ],
      },
    });

    expect(await forgetReadyPageCopy()).toBe(true);
    expect(deleted).toEqual([READY_CACHE_NAME]);
    expect(unregistered).toEqual(["https://dive.day/ready/"]);
  });

  it("unregisters the diver's worker before it deletes the copy", async () => {
    const steps: string[] = [];
    vi.stubGlobal("caches", {
      delete: async () => {
        steps.push("delete");
        return true;
      },
    });
    vi.stubGlobal("navigator", {
      serviceWorker: {
        getRegistrations: async () => [
          {
            scope: "https://dive.day/ready/",
            unregister: async () => {
              steps.push("unregister");
              return true;
            },
          },
        ],
      },
    });
    await forgetReadyPageCopy();
    // Security review 2, N2: another tab's save cannot land after the delete.
    expect(steps).toEqual(["unregister", "delete"]);
  });

  it("answers false, and throws nothing, when the cache cannot be deleted", async () => {
    const unregister = vi.fn(async () => true);
    vi.stubGlobal("caches", { delete: () => Promise.reject(new Error("quota")) });
    vi.stubGlobal("navigator", {
      serviceWorker: {
        getRegistrations: async () => [{ scope: "https://dive.day/ready/", unregister }],
      },
    });
    expect(await forgetReadyPageCopy()).toBe(false);
    expect(unregister).toHaveBeenCalledTimes(1);
  });

  it("still unregisters every /ready/ worker and deletes the copy when one unregister fails", async () => {
    const deleted: string[] = [];
    const second = vi.fn(async () => true);
    vi.stubGlobal("caches", {
      delete: async (name: string) => {
        deleted.push(name);
        return true;
      },
    });
    vi.stubGlobal("navigator", {
      serviceWorker: {
        getRegistrations: async () => [
          { scope: "https://dive.day/ready/", unregister: () => Promise.reject(new Error("busy")) },
          { scope: "https://dive.day/ready/", unregister: second },
        ],
      },
    });
    expect(await forgetReadyPageCopy()).toBe(true);
    expect(second).toHaveBeenCalledTimes(1);
    expect(deleted).toEqual([READY_CACHE_NAME]);
  });

  it("still deletes the copy when the registrations cannot be read", async () => {
    const deleted: string[] = [];
    vi.stubGlobal("caches", {
      delete: async (name: string) => {
        deleted.push(name);
        return true;
      },
    });
    vi.stubGlobal("navigator", {
      serviceWorker: { getRegistrations: () => Promise.reject(new Error("insecure")) },
    });
    expect(await forgetReadyPageCopy()).toBe(true);
    expect(deleted).toEqual([READY_CACHE_NAME]);
  });

  it("answers false, and throws nothing, in a browser with no Cache Storage", async () => {
    vi.stubGlobal("caches", undefined);
    vi.stubGlobal("navigator", {});
    expect(await forgetReadyPageCopy()).toBe(false);
  });
});
