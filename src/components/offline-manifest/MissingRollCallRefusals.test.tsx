// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { offlineManifestTranslator } from "@/i18n/offline-manifest-messages";
import { MissingRollCallRefusals } from "./MissingRollCallRefusals";
import { controls, view } from "./section-fixtures";

afterEach(cleanup);

it("shows a refused mark for a person no longer on the roster", () => {
  const trip = view();
  trip.envelope.events = [
    {
      clientEventId: "mark-1",
      snapshotId: "snap-trip-1",
      snapshotSavedAt: "2026-08-01T12:00:00.000Z",
      tripId: "trip-1",
      bookingId: "removed-booking",
      checkpoint: "after_dive_1",
      status: "boarded",
      occurredAt: "2026-08-01T13:00:00.000Z",
      syncStatus: "rejected",
      rejectionReason: "not_bookable",
    },
  ];
  render(<MissingRollCallRefusals view={trip} controls={controls()} />);
  expect(screen.getByRole("status")).toHaveTextContent("-booking at After dive 1 was not accepted");
});

it("identifies a refused mark for a subject still on the roster", () => {
  const trip = view();
  trip.envelope.events = [
    {
      clientEventId: "mark-1",
      snapshotId: "snap-trip-1",
      snapshotSavedAt: "2026-08-01T12:00:00.000Z",
      tripId: "trip-1",
      bookingId: "b-priya",
      checkpoint: "departure",
      status: "boarded",
      occurredAt: "2026-08-01T13:00:00.000Z",
      syncStatus: "rejected",
      rejectionReason: "not_bookable",
    },
  ];
  render(<MissingRollCallRefusals view={trip} controls={controls()} />);
  expect(screen.getByRole("status")).toHaveTextContent(
    "b-priya at Before departure was not accepted",
  );
});

it("warns that an unresolved mark remains on the device and its meeting is not confirmed", () => {
  const trip = view();
  trip.envelope.events = [
    {
      clientEventId: "mark-1",
      snapshotId: "snap-trip-1",
      snapshotSavedAt: "2026-08-01T12:00:00.000Z",
      tripId: "trip-1",
      bookingId: "removed-booking",
      checkpoint: "after_dive_1",
      status: "not_boarded",
      occurredAt: "2026-08-01T13:00:00.000Z",
      syncStatus: "pending",
      unresolvedReason: "meeting_identity_unverified",
      note: "Last seen at the ladder",
    },
  ];
  const { rerender } = render(<MissingRollCallRefusals view={trip} controls={controls()} />);
  expect(screen.getByRole("status")).toHaveTextContent(
    "Note on this device: Last seen at the ladder",
  );
  rerender(<MissingRollCallRefusals view={trip} controls={controls()} paper />);
  expect(screen.getByRole("status")).not.toHaveTextContent("Last seen at the ladder");
  expect(screen.getByRole("status")).toHaveTextContent(
    /Unconfirmed device observation.*-booking.*Not back aboard.*After dive 1.*meeting.*not confirmed.*device.*expire/i,
  );
});

it("names a rostered person without treating an ordinary pending tap as unresolved", () => {
  const trip = view();
  trip.envelope.snapshot.rollCallMeetingDays = [
    {
      startsAt: "2026-08-01T12:00:00Z",
      endsAt: "2026-08-01T14:00:00Z",
      meetingIdentityProof:
        "33333333-3333-4333-8333-333333333333.0.a.b.0.aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    },
  ];
  const event = {
    clientEventId: "mark-1",
    snapshotId: "snap-trip-1",
    snapshotSavedAt: "2026-08-01T12:00:00.000Z",
    tripId: "trip-1",
    bookingId: "b-priya",
    checkpoint: "departure" as const,
    status: "boarded" as const,
    meetingDay: 0,
    meetingIdentityProof:
      "33333333-3333-4333-8333-333333333333.0.a.b.0.aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    occurredAt: "2026-08-01T13:00:00.000Z",
    syncStatus: "pending" as const,
  };
  trip.envelope.events = [event];
  const { rerender } = render(<MissingRollCallRefusals view={trip} controls={controls()} />);
  expect(screen.queryByRole("status")).toBeNull();
  trip.envelope.events = [{ ...event, unresolvedReason: "unresolved_predecessor" }];
  rerender(<MissingRollCallRefusals view={trip} controls={controls()} />);
  expect(screen.getByRole("status")).toHaveTextContent(
    /Priya Shah.*Boarded.*Before departure.*earlier change needs review.*not confirmed in the live count/i,
  );
  trip.envelope.events = [{ ...event, unresolvedReason: "client_event_conflict" }];
  rerender(<MissingRollCallRefusals view={trip} controls={controls()} />);
  expect(screen.getByRole("status")).toHaveTextContent(
    /another change uses the same reference.*keep this observation for review.*not confirmed in the live count/i,
  );
});

it("distinguishes two observations and their reasons in Spanish", () => {
  const trip = view();
  const event = {
    clientEventId: "mark-1",
    snapshotId: "snap-trip-1",
    snapshotSavedAt: "2026-08-01T12:00:00.000Z",
    tripId: "trip-1",
    crewPersonId: "crew-dana",
    checkpoint: "departure" as const,
    status: "cleared" as const,
    occurredAt: "2026-08-01T13:00:00.000Z",
    syncStatus: "pending" as const,
  };
  trip.envelope.events = [
    { ...event, unresolvedReason: "meeting_identity_unverified" },
    {
      ...event,
      clientEventId: "mark-2",
      unresolvedReason: "unresolved_predecessor",
    },
  ];
  render(
    <MissingRollCallRefusals
      view={trip}
      controls={{ ...controls(), locale: "es-ES", t: offlineManifestTranslator("es-ES") }}
    />,
  );
  const items = screen.getAllByRole("listitem");
  expect(items).toHaveLength(2);
  expect(items[0]).toHaveTextContent(
    /Dana Divemaster.*Resultado borrado.*fecha no está confirmada/i,
  );
  expect(items[1]).toHaveTextContent(
    /Dana Divemaster.*Resultado borrado.*cambio anterior necesita revisión/i,
  );
  expect(items[0].textContent).not.toEqual(items[1].textContent);
  expect(items[0]).toHaveTextContent("Referencia mark-1");
  expect(items[1]).toHaveTextContent("Referencia mark-2");
});

it("uses a neutral review reason for an unknown unresolved status", () => {
  const trip = view();
  trip.envelope.events = [
    {
      clientEventId: "mark-3",
      snapshotId: "snap-trip-1",
      snapshotSavedAt: "2026-08-01T12:00:00.000Z",
      tripId: "trip-1",
      bookingId: "b-priya",
      checkpoint: "departure",
      status: "boarded",
      occurredAt: "2026-08-01T13:00:00.000Z",
      syncStatus: "pending",
      unresolvedReason: "future_reason",
    },
  ];
  render(<MissingRollCallRefusals view={trip} controls={controls()} />);
  expect(screen.getByRole("status")).toHaveTextContent("This change needs review.");
});

it("warns about a proofless tap on the same older saved copy before sync", () => {
  const trip = view();
  trip.envelope.events = [
    {
      clientEventId: "legacy-1",
      snapshotId: trip.envelope.snapshot.snapshotId,
      snapshotSavedAt: trip.envelope.snapshot.savedAt,
      tripId: "trip-1",
      bookingId: "b-priya",
      checkpoint: "departure",
      status: "boarded",
      meetingDay: 0,
      occurredAt: "2026-08-01T13:00:00.000Z",
      syncStatus: "pending",
    },
  ];
  render(<MissingRollCallRefusals view={trip} controls={controls()} />);
  expect(screen.getByRole("status")).toHaveTextContent(
    /Priya Shah.*Boarded.*meeting is not confirmed.*not confirmed in the live count/i,
  );
});

it("warns before sync when a changed meeting makes a pending mark and its correction uncertain", () => {
  const trip = view();
  trip.envelope.snapshot.rollCallMeetingDays = [
    {
      startsAt: "2026-08-01T12:00:00Z",
      endsAt: "2026-08-01T14:00:00Z",
      meetingIdentityProof:
        "11111111-1111-4111-8111-111111111111.0.a.b.0.aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    },
  ];
  const missing = {
    clientEventId: "mark-missing",
    snapshotId: "older-snapshot",
    snapshotSavedAt: "2026-08-01T12:00:00.000Z",
    tripId: "trip-1",
    bookingId: "b-priya",
    checkpoint: "after_dive_1" as const,
    status: "not_boarded" as const,
    occurredAt: "2026-08-01T13:00:00.000Z",
    meetingDay: 0,
    meetingIdentityProof:
      "22222222-2222-4222-8222-222222222222.0.c.d.0.aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    syncStatus: "pending" as const,
  };
  const correction = {
    ...missing,
    clientEventId: "mark-correction",
    snapshotId: trip.envelope.snapshot.snapshotId,
    meetingIdentityProof: trip.envelope.snapshot.rollCallMeetingDays[0].meetingIdentityProof,
    status: "boarded" as const,
    observedEvidenceIds: ["client:mark-missing"],
  };
  trip.envelope.events = [missing, correction];
  render(<MissingRollCallRefusals view={trip} controls={controls()} />);
  const items = screen.getAllByRole("listitem");
  expect(items).toHaveLength(2);
  expect(items[0]).toHaveTextContent(/Not back aboard.*meeting is not confirmed/i);
  expect(items[1]).toHaveTextContent(/Back aboard.*earlier change needs review/i);
});
