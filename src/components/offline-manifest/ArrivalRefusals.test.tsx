// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { OfflineArrivalRefusals } from "./ArrivalRefusals";
import { controls, view } from "./section-fixtures";
import { offlineTripView } from "./trip-view";

afterEach(cleanup);

it.each(["seat removed", "counter closed"])("shows a refused arrival when %s", () => {
  const trip = view();
  trip.envelope.arrivalEvents = [
    {
      clientEventId: "arrival-1",
      snapshotId: "snap-trip-1",
      snapshotSavedAt: "2026-08-01T12:00:00.000Z",
      tripId: "trip-1",
      bookingId: "b-priya",
      status: "arrived",
      occurredAt: "2026-08-01T12:01:00.000Z",
      syncStatus: "rejected",
      rejectionReason: "not_bookable",
    },
  ];
  trip.counterSeats = [];
  render(<OfflineArrivalRefusals view={trip} controls={controls()} />);
  expect(screen.getByRole("status")).toHaveTextContent(
    "Arrival change for booking b-priya was not accepted",
  );
  expect(screen.queryByText("Priya Shah")).toBeNull();
});

it("leaves a visible seat's refusal to its counter row", () => {
  const trip = view();
  trip.envelope.arrivalEvents = [
    {
      clientEventId: "arrival-1",
      snapshotId: "snap-trip-1",
      snapshotSavedAt: "2026-08-01T12:00:00.000Z",
      tripId: "trip-1",
      bookingId: "b-priya",
      status: "arrived",
      occurredAt: "2026-08-01T12:01:00.000Z",
      syncStatus: "rejected",
      rejectionReason: "not_bookable",
    },
  ];
  const refreshed = offlineTripView(trip.envelope, "departure");
  if (!refreshed) throw new Error("missing manifest");
  render(<OfflineArrivalRefusals view={refreshed} controls={controls()} />);
  expect(screen.queryByRole("status")).toBeNull();
});

it("keeps an earlier refusal visible after a later arrival", () => {
  const trip = view();
  trip.envelope.arrivalEvents = [
    {
      clientEventId: "old",
      snapshotId: "snap-trip-1",
      snapshotSavedAt: "2026-08-01T12:00:00.000Z",
      tripId: "trip-1",
      bookingId: "b-priya",
      status: "arrived",
      occurredAt: "2026-08-01T12:01:00.000Z",
      syncStatus: "rejected",
      rejectionReason: "not_bookable",
    },
    {
      clientEventId: "new",
      snapshotId: "snap-trip-1",
      snapshotSavedAt: "2026-08-01T12:00:00.000Z",
      tripId: "trip-1",
      bookingId: "b-priya",
      status: "arrived",
      occurredAt: "2026-08-01T12:02:00.000Z",
      syncStatus: "pending",
    },
  ];
  const refreshed = offlineTripView(trip.envelope, "departure");
  if (!refreshed) throw new Error("missing manifest");
  render(<OfflineArrivalRefusals view={refreshed} controls={controls()} />);
  expect(screen.getByRole("status")).toHaveTextContent("b-priya was not accepted");
});
