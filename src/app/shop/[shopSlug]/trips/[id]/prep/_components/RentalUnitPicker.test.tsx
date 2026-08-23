// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AssignGearUnitResult } from "../actions";
import { RentalUnitPicker } from "./RentalUnitPicker";

type Assign = (input: {
  tripId: string;
  bookingId: string;
  gearItemId: string;
}) => Promise<AssignGearUnitResult>;

afterEach(cleanup);

const COPY = {
  pickUnit: "Pick a unit…",
  assigning: "Assigning…",
  refusals: {
    unit_unavailable: "Somebody got that unit first — pick another.",
    unit_out_of_service: "That unit is off the wall for service.",
  },
  refusalFallback: "That pick didn't take — try another unit.",
};

const OPTIONS = [
  { id: "unit-1", label: "BCD #1 · M" },
  { id: "unit-2", label: "BCD #2 · L" },
];

function renderPicker(assign: Assign, defaultValue = "") {
  render(
    <>
      <label htmlFor="assign-1">Wetsuit</label>
      <RentalUnitPicker
        id="assign-1"
        tripId="trip-1"
        bookingId="booking-1"
        options={OPTIONS}
        defaultValue={defaultValue}
        assign={assign}
        copy={COPY}
      />
    </>,
  );
  return screen.getByLabelText("Wetsuit") as HTMLSelectElement;
}

/**
 * **The pick is the act, and the refusal is why this is a component.**
 *
 * The row used to be a `<form>` with a separate "Assign" button — 21 of them on
 * a seeded departure, 42 taps at a counter on the morning of a departure
 * (issue #802). Committing on change is the easy half. The hard half is that a
 * reservation's double-booking guard is a Postgres exclusion constraint, so
 * availability cannot be pre-checked as truth: the answer only exists *after*
 * the write, and a select that has already moved has to move back.
 */
describe("RentalUnitPicker", () => {
  it("commits the pick without a second tap", async () => {
    const assign = vi.fn(async () => ({ ok: true }) as const);
    const select = renderPicker(assign);
    fireEvent.change(select, { target: { value: "unit-2" } });

    await waitFor(() =>
      expect(assign).toHaveBeenCalledWith({
        tripId: "trip-1",
        bookingId: "booking-1",
        gearItemId: "unit-2",
      }),
    );
    expect(select.value).toBe("unit-2");
    // Nothing to confirm and nothing to apologise for.
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("puts the select back and says why when the write is refused", async () => {
    const assign = vi.fn(async () => ({ ok: false, reason: "unit_unavailable" }) as const);
    const select = renderPicker(assign, "unit-1");
    fireEvent.change(select, { target: { value: "unit-2" } });

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("Somebody got that unit first"),
    );
    // Back to what it held — the row never claims a reservation the database
    // refused.
    expect(select.value).toBe("unit-1");
    expect(select).toHaveAttribute("aria-describedby", "assign-1-refusal");
  });

  /**
   * Two refusals in a row must not leave the revert target pointing at a unit
   * this diver never held — `previous` only advances on success.
   */
  it("reverts to the last unit that actually took, not the last one tried", async () => {
    const assign = vi.fn(async () => ({ ok: false, reason: "unit_unavailable" }) as const);
    const select = renderPicker(assign, "unit-1");

    fireEvent.change(select, { target: { value: "unit-2" } });
    await waitFor(() => expect(select.value).toBe("unit-1"));
    fireEvent.change(select, { target: { value: "unit-2" } });
    await waitFor(() => expect(select.value).toBe("unit-1"));
    expect(assign).toHaveBeenCalledTimes(2);
  });

  it("says something for a refusal this build has no sentence for", async () => {
    const assign = vi.fn(async () => ({ ok: false, reason: "invalid" }) as const);
    const select = renderPicker(assign, "unit-1");
    fireEvent.change(select, { target: { value: "unit-2" } });

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("That pick didn't take"),
    );
  });

  it("does not re-send the unit it already holds", async () => {
    const assign = vi.fn(async () => ({ ok: true }) as const);
    const select = renderPicker(assign, "unit-1");
    fireEvent.change(select, { target: { value: "unit-1" } });
    expect(assign).not.toHaveBeenCalled();
  });

  it("clears a refusal when the next pick is tried", async () => {
    const assign = vi
      .fn<Assign>()
      .mockResolvedValueOnce({ ok: false, reason: "unit_unavailable" })
      .mockResolvedValueOnce({ ok: true });
    const select = renderPicker(assign, "unit-1");

    fireEvent.change(select, { target: { value: "unit-2" } });
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    fireEvent.change(select, { target: { value: "unit-2" } });
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect(select.value).toBe("unit-2");
  });
});
