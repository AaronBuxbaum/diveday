// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchOfflineManifestShopSlug } from "@/lib/offline-manifests";
import { useOfflineTenant } from "./use-offline-tenant";

vi.mock("@/lib/offline-manifests", () => ({ fetchOfflineManifestShopSlug: vi.fn() }));

const lookup = vi.mocked(fetchOfflineManifestShopSlug);

beforeEach(() => lookup.mockReset());

describe("useOfflineTenant", () => {
  it("shares one lookup between two callers in the same round, and caches the answer", async () => {
    lookup.mockResolvedValue("blue-mantis");
    const { result } = renderHook(() => useOfflineTenant());
    const [first, second] = await Promise.all([
      result.current.resolveTenant(),
      result.current.resolveTenant(),
    ]);
    expect([first, second]).toEqual(["blue-mantis", "blue-mantis"]);
    expect(await result.current.resolveTenant()).toBe("blue-mantis");
    expect(result.current.tenantSlugRef.current).toBe("blue-mantis");
    expect(lookup).toHaveBeenCalledTimes(1);
  });

  it("caches no answer when the server gives none, and asks again next time", async () => {
    lookup.mockResolvedValue(null);
    const { result } = renderHook(() => useOfflineTenant());
    expect(await result.current.resolveTenant()).toBeNull();
    expect(await result.current.resolveTenant()).toBeNull();
    expect(result.current.tenantSlugRef.current).toBeNull();
    expect(lookup).toHaveBeenCalledTimes(2);
  });

  it("does not let a pre-invalidation lookup restore a stale tenant", async () => {
    let resolveOld: (slug: string | null) => void = () => {};
    lookup.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveOld = resolve;
        }),
    );
    lookup.mockResolvedValueOnce("reef-runners");
    const { result } = renderHook(() => useOfflineTenant());
    const oldLookup = result.current.resolveTenant();
    result.current.invalidateTenantLookup();
    resolveOld("blue-mantis");
    const oldAnswer = await oldLookup;
    expect(oldAnswer).toBeNull();
    expect(result.current.tenantSlugRef.current).toBeNull();
    expect(await result.current.resolveTenant()).toBe("reef-runners");
    expect(lookup).toHaveBeenCalledTimes(2);
  });
});
