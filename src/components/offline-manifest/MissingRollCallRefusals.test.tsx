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
      meetingDay: 1,
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
  expect(screen.getByRole("status").parentElement).toHaveTextContent(
    "The saved copy does not contain the original subject name. Reference: removed-booking",
  );
  expect(screen.getByRole("status").parentElement).toHaveTextContent("Recorded: Not back aboard");
  expect(screen.getByRole("status").parentElement).toHaveTextContent("Original meeting day: 2");
  expect(screen.getByRole("status").parentElement).toHaveTextContent(
    "Original trip title unavailable. Trip reference: trip-1",
  );
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

it("names the original subject only when the saved copy is the capture snapshot", () => {
  const trip = view();
  trip.envelope.events = [
    {
      clientEventId: "mark-review",
      snapshotId: "snap-trip-1",
      snapshotSavedAt: "2026-08-01T12:00:00.000Z",
      tripId: "trip-1",
      bookingId: "b-priya",
      checkpoint: "departure",
      status: "boarded",
      occurredAt: "2026-08-01T13:00:00.000Z",
      syncStatus: "pending",
      reviewRequired: true,
    },
  ];
  const { rerender } = render(<MissingRollCallRefusals view={trip} controls={controls()} />);
  expect(screen.getByRole("status").parentElement).toHaveTextContent(
    "Original subject: Priya Shah",
  );
  trip.envelope.snapshot.snapshotId = "different-snapshot";
  rerender(<MissingRollCallRefusals view={trip} controls={controls()} />);
  expect(screen.getByRole("status").parentElement).toHaveTextContent(
    "The saved copy does not contain the original subject name",
  );
  expect(screen.getByRole("status").parentElement).not.toHaveTextContent("Priya Shah");
  expect(screen.getByRole("status").parentElement).toHaveTextContent(
    "Original trip title unavailable. Trip reference: trip-1",
  );
  expect(screen.getByRole("status").parentElement).not.toHaveTextContent(
    "Saved trip: Two-Tank Reef",
  );
});
