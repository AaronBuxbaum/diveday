// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { OfflineRollCallEvent } from "@/lib/offline-manifests";
import { ReviewObservation } from "./ReviewObservation";
import { controls, savedCopy } from "./section-fixtures";

const store = vi.hoisted(() => ({
  prepareOfflineRollCallConfirmation: vi.fn(),
  completeOfflineRollCallConfirmation: vi.fn(),
  discardOfflineRollCallReview: vi.fn(),
  loadOfflineManifest: vi.fn(),
}));
vi.mock("@/lib/offline-manifest-store", () => store);
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function observation(): OfflineRollCallEvent {
  return {
    clientEventId: "old-observation",
    snapshotId: "old-snapshot",
    snapshotSavedAt: "2026-08-01T12:00:00Z",
    tripId: "trip-1",
    bookingId: "b-priya",
    checkpoint: "departure",
    status: "not_boarded",
    occurredAt: "2026-08-01T13:00:00Z",
    syncStatus: "pending",
    reviewRequired: true,
  };
}

it("requires an explicit choice and matches the new live receipt before resolving the original", async () => {
  const envelope = savedCopy();
  envelope.events = [observation()];
  const current = {
    ...envelope.snapshot,
    rollCallMeetingDay: 0,
    rollCallWitnesses: { "seat:b-priya:departure": "proof" },
  };
  const context = { snapshotId: current.snapshotId, meetingDay: 0, witness: "proof" };
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(new Response(JSON.stringify({ current }), { status: 200 }))
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ status: "applied", confirmationId: "confirmation-1" }), {
        status: 200,
      }),
    );
  vi.stubGlobal("fetch", fetcher);
  store.prepareOfflineRollCallConfirmation.mockResolvedValue({
    confirmationId: "confirmation-1",
    context,
  });
  store.loadOfflineManifest.mockResolvedValue(envelope);
  store.completeOfflineRollCallConfirmation.mockResolvedValue(envelope);
  const onReviewEnvelope = vi.fn();
  render(
    <ReviewObservation
      event={observation()}
      controls={{
        ...controls(),
        reviewTenant: async () => ({ shopSlug: "blue-mantis", round: 1 }),
        onReviewEnvelope,
      }}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Review current roster" }));
  await screen.findByText(/current seat names Priya Shah/);
  expect(screen.getByRole("button", { name: "Confirm new live mark" })).toBeDisabled();
  fireEvent.click(screen.getByLabelText("Boarded"));
  fireEvent.click(screen.getByRole("button", { name: "Confirm new live mark" }));
  await waitFor(() =>
    expect(store.completeOfflineRollCallConfirmation).toHaveBeenCalledWith(
      "trip-1",
      "old-observation",
      "confirmation-1",
      "blue-mantis",
      1,
    ),
  );
  expect(JSON.parse(fetcher.mock.calls[1][1].body)).toMatchObject({
    status: "boarded",
    confirmationId: "confirmation-1",
    confirmed: true,
    ...context,
  });
  expect(onReviewEnvelope).toHaveBeenCalled();
});

it("does not resolve a review when the receipt does not match", async () => {
  const envelope = savedCopy();
  const current = {
    ...envelope.snapshot,
    rollCallMeetingDay: 0,
    rollCallWitnesses: { "seat:b-priya:departure": "proof" },
  };
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ current }), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ status: "applied", confirmationId: "other" }), {
          status: 200,
        }),
      ),
  );
  store.prepareOfflineRollCallConfirmation.mockResolvedValue({
    confirmationId: "confirmation-1",
    context: { snapshotId: current.snapshotId, meetingDay: 0, witness: "proof" },
  });
  store.loadOfflineManifest.mockResolvedValue(envelope);
  render(
    <ReviewObservation
      event={observation()}
      controls={{
        ...controls(),
        reviewTenant: async () => ({ shopSlug: "blue-mantis", round: 1 }),
        onReviewEnvelope: vi.fn(),
      }}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Review current roster" }));
  await screen.findByText(/current seat names Priya Shah/);
  fireEvent.click(screen.getByLabelText("Boarded"));
  fireEvent.click(screen.getByRole("button", { name: "Confirm new live mark" }));
  await screen.findByRole("alert");
  expect(store.completeOfflineRollCallConfirmation).not.toHaveBeenCalled();
});

it("retries the exact earlier confirmation even when the subject is no longer on the current roster", async () => {
  const envelope = savedCopy();
  const event = observation();
  const context = { snapshotId: "previous-snapshot", meetingDay: 0, witness: "previous-proof" };
  event.reviewConfirmation = { clientEventId: "confirmation-1", status: "boarded", context };
  const fetcher = vi.fn().mockResolvedValueOnce(
    new Response(JSON.stringify({ status: "duplicate", confirmationId: "confirmation-1" }), {
      status: 200,
    }),
  );
  vi.stubGlobal("fetch", fetcher);
  store.completeOfflineRollCallConfirmation.mockResolvedValue(envelope);
  render(
    <ReviewObservation
      event={event}
      controls={{
        ...controls(),
        reviewTenant: async () => ({ shopSlug: "blue-mantis", round: 1 }),
        onReviewEnvelope: vi.fn(),
      }}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Retry previous confirmation" }));
  await waitFor(() => expect(store.completeOfflineRollCallConfirmation).toHaveBeenCalled());
  expect(JSON.parse(fetcher.mock.calls[0][1].body)).toMatchObject({
    confirmationId: "confirmation-1",
    ...context,
  });
  expect(store.prepareOfflineRollCallConfirmation).not.toHaveBeenCalled();
});

it("requires a second deliberate action before discarding an unresolved observation", async () => {
  const envelope = savedCopy();
  const onReviewEnvelope = vi.fn();
  store.discardOfflineRollCallReview.mockResolvedValue(envelope);
  render(
    <ReviewObservation
      event={observation()}
      controls={{
        ...controls(),
        reviewTenant: async () => ({ shopSlug: "blue-mantis", round: 1 }),
        onReviewEnvelope,
      }}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Discard observation" }));
  expect(store.discardOfflineRollCallReview).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Confirm discard of this observation" }));
  await waitFor(() =>
    expect(store.discardOfflineRollCallReview).toHaveBeenCalledWith(
      "trip-1",
      "old-observation",
      "blue-mantis",
      1,
    ),
  );
  expect(onReviewEnvelope).toHaveBeenCalledWith(envelope);
});
