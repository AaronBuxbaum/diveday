// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { useRef, useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { listOfflineManifests } from "@/lib/offline-manifest-store";
import type { OfflineManifestEnvelope } from "@/lib/offline-manifests";
import { useTripPendingManifestInventory } from "./use-saved-manifest-list";

const subscription = vi.hoisted(() => ({ notify: () => {} }));
vi.mock("@/lib/offline-manifest-store", () => ({
  listOfflineManifests: vi.fn(),
  subscribeOfflineManifestChanges: (listener: () => void) => {
    subscription.notify = listener;
    return () => {};
  },
  syncOfflineManifest: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it("removes a prior caught-up message when the inventory becomes unreadable", async () => {
  vi.mocked(listOfflineManifests)
    .mockResolvedValueOnce([])
    .mockRejectedValueOnce(new Error("unreadable"));
  const onInventoryReady = vi.fn();
  const { result } = renderHook(() => {
    const tenantSlugRef = useRef<string | null>("blue-mantis");
    const ready = useRef(false);
    const [message, setMessage] = useState("Everything sent");
    const [list, setList] = useState<OfflineManifestEnvelope[]>([]);
    useTripPendingManifestInventory({
      tripId: "trip-1",
      tenantSlugRef,
      verifiedTenantRevision: 1,
      inventoryReadyRef: ready,
      setList,
      setMessage,
      onInventoryReady,
      allCaughtUpMessage: "Everything sent",
    });
    return { message, ready, list, setMessage };
  });
  await waitFor(() => expect(result.current.ready.current).toBe(true));
  act(() => result.current.setMessage("Everything sent"));
  act(() => subscription.notify());
  await waitFor(() => expect(result.current.ready.current).toBe(false));
  expect(result.current.message).not.toBe("Everything sent");
});
