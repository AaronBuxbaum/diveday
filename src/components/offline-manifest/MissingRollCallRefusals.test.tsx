// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { MissingRollCallRefusals } from "./MissingRollCallRefusals";
import { controls, view } from "./section-fixtures";

afterEach(cleanup);

it("identifies an unsent observation requiring manual review", () => {
  const trip = view();
  trip.envelope.events = [
    {
      clientEventId: "mark-review",
      snapshotId: "snap-trip-1",
      snapshotSavedAt: "2026-08-01T12:00:00.000Z",
      tripId: "trip-1",
      bookingId: "removed-booking",
      checkpoint: "after_dive_1",
      status: "not_boarded",
      occurredAt: "2026-08-01T13:00:00.000Z",
      syncStatus: "pending",
      reviewRequired: true,
      rejectionReason: "booking_unavailable",
    },
  ];
  render(<MissingRollCallRefusals view={trip} controls={controls()} />);
  expect(screen.getByRole("status")).toHaveTextContent("remains on this device");
  expect(screen.getByRole("status")).toHaveTextContent("manual roll call");
  expect(screen.getByRole("status")).toHaveTextContent("Original subject: removed-booking");
  expect(screen.getByRole("status")).toHaveTextContent("Recorded: Not back aboard");
  expect(screen.getByRole("status")).toHaveTextContent("Two-Tank Reef");
});

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
