// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { offlineManifestTranslator } from "@/i18n/offline-manifest-messages";
import { controls, savedCopy, view } from "./section-fixtures";
import { OfflineTripHeader } from "./TripHeader";
import { offlineTripView } from "./trip-view";

afterEach(cleanup);

describe("OfflineTripHeader", () => {
  it("draws the header with the departure's title", () => {
    const { container } = render(<OfflineTripHeader view={view()} controls={controls()} />);
    expect(container.textContent).toContain("Two-Tank Reef");
  });

  it("names the shop time zone on the saved time when the live site did not answer", () => {
    const { container } = render(
      <OfflineTripHeader view={view()} controls={{ ...controls(), servedWithoutAnswer: true }} />,
    );
    expect(container.textContent).toMatch(/Saved.*8:00\s*AM\s*(?:EDT|GMT-4|UTC-4)/);
  });

  it("uses the shop's winter offset for a saved timestamp", () => {
    const copy = savedCopy();
    copy.snapshot.savedAt = "2026-01-01T12:00:00.000Z";
    const winter = offlineTripView(copy, "departure");
    if (!winter) throw new Error("the fixture carries a manifest");
    const { container } = render(<OfflineTripHeader view={winter} controls={controls()} />);
    expect(container.textContent).toMatch(/Saved.*7:00\s*AM\s*(?:EST|GMT-5|UTC-5)/);
  });

  it("qualifies saved readiness and note loss when the saved copy has a blocked diver", () => {
    const copy = savedCopy();
    copy.snapshot.manifests[0].divers[0].readiness = { status: "blocked", blockers: [] };
    copy.events = [
      {
        clientEventId: "erased-note-event",
        snapshotId: copy.snapshot.snapshotId,
        snapshotSavedAt: copy.snapshot.savedAt,
        tripId: copy.snapshot.manifests[0].trip.id,
        bookingId: "booking-12345678",
        checkpoint: "departure",
        status: "boarded",
        note: null,
        occurredAt: copy.snapshot.savedAt,
        syncStatus: "applied",
        noteDisposition: "discarded_erasure_cutoff",
      },
    ];
    const noteLossView = offlineTripView(copy, "departure");
    if (!noteLossView) throw new Error("the fixture carries a manifest");
    expect(noteLossView.manifest.divers[0].readiness.status).toBe("blocked");

    const { container } = render(<OfflineTripHeader view={noteLossView} controls={controls()} />);

    expect(container.textContent).toContain("Fresh roster · older notes removed");
    expect(container.textContent).toContain(
      "The saved roster is current. Readiness reflects that moment, and we’ll re-check everything once you’re back in signal. Older offline note text was removed after a data erasure; see the notice below.",
    );
    expect(container.textContent).toContain(
      "Older offline note text was removed after a data erasure",
    );
    expect(container.textContent).not.toContain("Everything’s sent.");
    expect(container.textContent).not.toContain("0 waiting to send · 0 need a look");
  });

  it("distinguishes a stale Spanish copy from an expired one", () => {
    const spanish = { ...controls(), t: offlineManifestTranslator("es-ES") };
    const { container, rerender } = render(
      <OfflineTripHeader
        view={{ ...view(), freshness: "stale", expired: false }}
        controls={spanish}
      />,
    );
    expect(container.textContent).toContain("Copia desactualizada");
    rerender(
      <OfflineTripHeader
        view={{ ...view(), freshness: "stale", expired: true }}
        controls={spanish}
      />,
    );
    expect(container.textContent).toMatch(/caducad/i);
  });
});
