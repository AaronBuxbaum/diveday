// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OfflineDeckRollCall } from "./DeckRollCall";
import { controls, view } from "./section-fixtures";

afterEach(cleanup);

describe("saved Deck receipts", () => {
  it("names a saved passenger whose count needs review", () => {
    const current = view();
    const passenger = current.manifest.divers[0];
    if (!passenger) throw new Error("passenger missing");
    passenger.recountRequired = true;
    render(<OfflineDeckRollCall view={current} controls={controls()} details={null} />);
    expect(screen.getByText(/1 person needs a recount/)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Find a person" }));
    fireEvent.click(screen.getByRole("button", { name: "Priya Shah" }));
    expect(screen.getByText(/Recount required · Recount online/)).toBeVisible();
  });
  it("keeps a failed local append on the same person without offering Next", async () => {
    const ctx = controls();
    const record = vi.fn(async () => false);
    ctx.record = record;
    render(<OfflineDeckRollCall view={view()} controls={ctx} details={null} />);
    fireEvent.click(screen.getByRole("button", { name: "Start roll call" }));
    fireEvent.click(screen.getByRole("button", { name: "Record Priya Shah aboard" }));
    await waitFor(() => expect(screen.getByRole("alert")).toBeVisible());
    expect(screen.getByRole("heading", { name: "Priya Shah" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Next person" })).toBeNull();
    expect(record).toHaveBeenCalledWith({ bookingId: "b-priya" }, { status: "boarded" });
  });

  it("uses the appended event's receipt and undo target before a new projection arrives", async () => {
    const ctx = controls();
    const record = vi.fn(async () => ({
      ok: true as const,
      observedAt: "2026-08-01T12:05:00.000Z",
      eventId: "fresh-device-event",
      pending: true,
    }));
    ctx.record = record;
    render(<OfflineDeckRollCall view={view()} controls={ctx} details={null} />);
    fireEvent.click(screen.getByRole("button", { name: "Start roll call" }));
    fireEvent.click(screen.getByRole("button", { name: "Record Priya Shah aboard" }));
    await waitFor(() => expect(screen.getByText("Aboard recorded")).toBeVisible());
    expect(screen.getByText(ctx.t("manifest.deck.pendingReceipt"))).toBeVisible();
    expect(screen.getByRole("heading", { name: "Priya Shah" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Undo Priya Shah’s record" }));
    await waitFor(() => expect(record).toHaveBeenCalledTimes(2));
    expect(record.mock.calls[1]).toEqual([
      { bookingId: "b-priya" },
      { status: "cleared", retractsClientEventId: "fresh-device-event" },
    ]);
  });

  it("Find and next-person navigation create no offline statements", async () => {
    const ctx = controls();
    const record = vi.fn(async () => ({
      ok: true as const,
      observedAt: "2026-08-01T12:05:00.000Z",
      eventId: "first",
      pending: true,
    }));
    ctx.record = record;
    render(<OfflineDeckRollCall view={view()} controls={ctx} details={null} />);
    fireEvent.click(screen.getByRole("button", { name: "Find a person" }));
    fireEvent.click(screen.getByRole("button", { name: "Priya Shah" }));
    expect(record).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Record Priya Shah aboard" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Next person" })).toBeVisible());
    fireEvent.click(screen.getByRole("button", { name: "Next person" }));
    expect(screen.getByRole("heading", { name: "Marcus Reed" })).toBeVisible();
    expect(record).toHaveBeenCalledTimes(1);
  });

  it("updates the same receipt's delivery after sync without recording another observation", async () => {
    const ctx = controls();
    const record = vi.fn(async () => ({
      ok: true as const,
      observedAt: "2026-08-01T12:05:00.000Z",
      eventId: "same-person-event",
      pending: true,
    }));
    ctx.record = record;
    const initial = view();
    const { rerender } = render(
      <OfflineDeckRollCall view={initial} controls={ctx} details={null} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Start roll call" }));
    fireEvent.click(screen.getByRole("button", { name: "Record Priya Shah aboard" }));
    await waitFor(() =>
      expect(screen.getByText(ctx.t("manifest.deck.pendingReceipt"))).toBeVisible(),
    );
    const synced = view();
    synced.localStates[0] = {
      state: "boarded",
      occurredAt: "2026-08-01T12:05:00.000Z",
      pending: false,
      implied: false,
      local: true,
      clientEventId: "same-person-event",
    };
    rerender(<OfflineDeckRollCall view={synced} controls={ctx} details={null} />);
    await waitFor(() =>
      expect(screen.queryByText(ctx.t("manifest.deck.pendingReceipt"))).toBeNull(),
    );
    expect(screen.getByRole("heading", { name: "Priya Shah" })).toBeVisible();
    expect(record).toHaveBeenCalledTimes(1);
  });

  it("keeps an expired copy's refusal visible before opening Details", () => {
    const expired = { ...view(), expired: true };
    render(<OfflineDeckRollCall view={expired} controls={controls()} details={null} />);
    expect(screen.getByText(/This saved copy has expired/)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Start roll call" }));
    expect(screen.getByRole("button", { name: "Record Priya Shah aboard" })).toBeDisabled();
  });

  it("shows the saved-copy caveat during a routine roll call and retains full details", () => {
    const ctx = { ...controls(), copyCaveat: "offline" as const };
    render(<OfflineDeckRollCall view={view()} controls={ctx} details={null} />);
    expect(screen.getByText(ctx.t("manifest.deck.copyCaveat"))).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Start roll call" }));
    expect(screen.getByText(ctx.t("manifest.deck.copyCaveat"))).toBeVisible();
    fireEvent.click(screen.getByText("More", { selector: "summary" }));
    expect(screen.getByText(/Count heads on the boat against this list/)).toBeVisible();
  });
});
