// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { useRef, useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { offlineManifestTranslator } from "@/i18n/offline-manifest-messages";
import { savedCopy } from "./section-fixtures";
import { useSelectedTripEnvelopeHandler } from "./selected-trip-envelope";

const t = offlineManifestTranslator("en-US");

describe("selected trip envelope status", () => {
  it("sets status when a copy appears after an empty read, then preserves a local save confirmation", () => {
    const envelope = savedCopy();
    const tripId = envelope.snapshot.manifests[0]?.trip.id;
    if (!tripId) throw new Error("fixture missing trip id");
    const { result, rerender } = renderHook(
      ({ selectedTripId }: { selectedTripId: string }) => {
        const [message, setMessage] = useState("");
        const handler = useSelectedTripEnvelopeHandler({
          tripId: selectedTripId,
          verifiedTenantSlugRef: useRef<string | null>("blue-mantis"),
          dispatchSaved: vi.fn(),
          setCheckpoint: vi.fn(),
          tripNoticeForEnvelope: vi.fn(() => ""),
          tripPurgedRef: useRef(false),
          setMessage,
          t,
          reconcile: vi.fn(async () => {}),
        });
        return { handler, message, setMessage };
      },
      { initialProps: { selectedTripId: tripId } },
    );

    act(() => result.current.handler(null));
    expect(result.current.message).toBe(t("shared.offlineManifest.reconcile.noneForTrip"));

    act(() => result.current.handler(envelope));
    expect(result.current.message).toBe(t("shared.offlineManifest.reconcile.ready"));

    act(() => result.current.setMessage(t("shared.offlineManifest.single.record.saved")));
    act(() => result.current.handler({ ...envelope, checklistEvents: [] }));
    expect(result.current.message).toBe(t("shared.offlineManifest.single.record.saved"));

    rerender({ selectedTripId: "another-trip" });
    act(() => result.current.handler(null));
    expect(result.current.message).toBe(t("shared.offlineManifest.reconcile.noneForTrip"));
  });
});
