// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { nowDate } from "@/lib/clock";
import { OfflineManifestSheet } from "./ManifestSheet";
import { controls, savedCopy } from "./section-fixtures";
import { offlineTripView } from "./trip-view";

vi.mock("@/lib/offline-manifest-store", () => ({
  getActiveOfflineShellVersion: vi.fn().mockResolvedValue(null),
}));
afterEach(cleanup);

it("prints unique people and names overlapping roles without changing either role record", () => {
  const copy = savedCopy();
  copy.snapshot.savedAt = nowDate().toISOString();
  copy.snapshot.expiresAt = "2099-01-01T00:00:00.000Z";
  const manifest = copy.snapshot.manifests[0];
  const crew = manifest?.crew[0];
  const passenger = manifest?.divers[0];
  if (!manifest || !crew || !passenger) throw new Error("fixture roles missing");
  passenger.personId = crew.id;
  manifest.trip.certifiedTotalPersons = 2;
  for (const row of [...manifest.divers, ...manifest.crew])
    row.rollCall = { state: "boarded", occurredAt: nowDate().toISOString() } as typeof row.rollCall;
  const view = offlineTripView(copy, "departure");
  if (!view) throw new Error("fixture view missing");
  expect(view.overTotalPersons).toBeNull();
  expect(view.crewAssigned).toBe(1);
  expect(view.totalDivers).toBe(2);
  const { container } = render(
    <OfflineManifestSheet
      view={view}
      controls={controls()}
      origin="https://app.diveday.test"
      onBack={vi.fn()}
      autoPrint={false}
    />,
  );
  expect(container.querySelector("[data-sheet-souls]")?.textContent).toBe(
    "Passengers 2 · Crew 1 · Souls on board 2 · 1 person has both roles",
  );
});
