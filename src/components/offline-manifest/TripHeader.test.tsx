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
