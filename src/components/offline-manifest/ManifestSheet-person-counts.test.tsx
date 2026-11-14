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

it("prints a non-numeric warning for an unresolved unlisted person", () => {
  const copy = savedCopy();
  copy.snapshot.savedAt = nowDate().toISOString();
  copy.events.push({
    clientEventId: crypto.randomUUID(),
    snapshotId: copy.snapshot.snapshotId,
    snapshotSavedAt: copy.snapshot.savedAt,
    tripId: "trip-1",
    crewPersonId: "removed-crew",
    checkpoint: "departure",
    status: "boarded",
    meetingDay: 0,
    occurredAt: copy.snapshot.savedAt,
    syncStatus: "pending",
    unresolvedReason: "unresolved_predecessor",
  });
  const view = offlineTripView(copy, "departure");
  if (!view) throw new Error("view missing");
  const { container } = render(
    <OfflineManifestSheet
      view={view}
      controls={controls()}
      origin="https://app.diveday.test"
      onBack={vi.fn()}
      autoPrint={false}
    />,
  );
  expect(container.querySelector("[data-sheet-possible-unlisted-person]")?.textContent).toMatch(
    /unlisted person may be aboard.*Count everyone and check capacity/i,
  );
});

it("prints a possible capacity warning for unresolved boarding evidence", () => {
  const copy = savedCopy();
  copy.snapshot.savedAt = nowDate().toISOString();
  const manifest = copy.snapshot.manifests[0];
  manifest.trip.certifiedTotalPersons = 2;
  const aboard = {
    state: "boarded" as const,
    occurredAt: copy.snapshot.savedAt,
    recordedByName: "Captain",
  };
  manifest.divers = manifest.divers.map((diver) => ({ ...diver, rollCall: aboard }));
  manifest.crew = manifest.crew.map((member) => ({ ...member, rollCall: aboard }));
  manifest.divers[0].rollCall = undefined;
  const proof = `33333333-3333-4333-8333-333333333333.0.a.b.${"a".repeat(43)}`;
  copy.snapshot.rollCallMeetingDays = [
    { startsAt: manifest.trip.startsAt, endsAt: manifest.trip.endsAt, meetingIdentityProof: proof },
  ];
  const first = {
    clientEventId: crypto.randomUUID(),
    snapshotId: copy.snapshot.snapshotId,
    snapshotSavedAt: copy.snapshot.savedAt,
    tripId: "trip-1",
    bookingId: "b-priya",
    checkpoint: "departure" as const,
    status: "boarded" as const,
    meetingDay: 0,
    meetingIdentityProof: proof,
    occurredAt: copy.snapshot.savedAt,
    syncStatus: "pending" as const,
  };
  copy.events.push(first, {
    ...first,
    clientEventId: crypto.randomUUID(),
    status: "not_boarded",
    observedEvidenceIds: [`client:${first.clientEventId}`],
    unresolvedReason: "unresolved_predecessor",
  });
  const view = offlineTripView(copy, "departure");
  if (!view) throw new Error("view missing");
  const { container } = render(
    <OfflineManifestSheet
      view={view}
      controls={controls()}
      origin="https://app.diveday.test"
      onBack={vi.fn()}
      autoPrint={false}
    />,
  );
  expect(container.querySelector("[data-sheet-possible-over-capacity]")?.textContent).toMatch(
    /3 people may be aboard.*certificate allows 2.*Count everyone/i,
  );
});

it("keeps the next count open on paper after an unconfirmed dock absence", () => {
  const copy = savedCopy();
  copy.snapshot.savedAt = nowDate().toISOString();
  const departure = copy.snapshot.manifests[0];
  copy.snapshot.manifests.push({ ...structuredClone(departure), checkpoint: "after_dive_1" });
  const proof = `33333333-3333-4333-8333-333333333333.0.a.b.${"a".repeat(43)}`;
  copy.snapshot.rollCallMeetingDays = [
    {
      startsAt: departure.trip.startsAt,
      endsAt: departure.trip.endsAt,
      meetingIdentityProof: proof,
    },
  ];
  for (const subject of [{ bookingId: "b-priya" }, { crewPersonId: "crew-dana" }])
    copy.events.push({
      clientEventId: crypto.randomUUID(),
      snapshotId: copy.snapshot.snapshotId,
      snapshotSavedAt: copy.snapshot.savedAt,
      tripId: "trip-1",
      ...subject,
      checkpoint: "departure",
      status: "not_boarded",
      meetingDay: 0,
      meetingIdentityProof: proof,
      occurredAt: copy.snapshot.savedAt,
      syncStatus: "pending",
      unresolvedReason: "unresolved_predecessor",
    });
  const view = offlineTripView(copy, "after_dive_1");
  if (!view) throw new Error("fixture view missing");
  expect(view.awaiting).toBe(2);
  expect(view.rollCallComplete).toBe(false);
  const { container } = render(
    <OfflineManifestSheet
      view={view}
      controls={controls()}
      origin="https://app.diveday.test"
      onBack={vi.fn()}
      autoPrint={false}
    />,
  );
  expect(container.querySelector(".paper-sheet")?.textContent).toMatch(
    /Unconfirmed device observation.*Priya Shah/,
  );
  expect(container.querySelector(".paper-sheet")?.textContent).toMatch(/Awaiting\s*2/i);
});

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
