// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { seatHoldersOf, TripHull } from "./TripHull";
import type { ReadinessByBooking, ReadinessRow, RosterEntry } from "./types";

afterEach(cleanup);

/**
 * The two derivations under the departure's hull, both of which fail *silently*
 * when they are wrong: a roster row that never reaches a seat, and a name that
 * shortens to half a glyph. A dive-domain review on 2026-09-19 found the first
 * one live, and found it because nothing here was testing it.
 */

type Booking = RosterEntry["booking"];
type Person = RosterEntry["person"];

function entry(input: { id: string; name: string; status: Booking["status"] }): RosterEntry {
  return {
    booking: { id: input.id, status: input.status } as Booking,
    person: { id: `p-${input.id}`, fullName: input.name } as Person,
  };
}

const ready: ReadinessByBooking = new Map();

function seatsOf(container: HTMLElement): Element[] {
  return [...container.querySelectorAll("rect")].filter((node) => node.getAttribute("rx") === "9");
}

function lettersOf(container: HTMLElement): string[] {
  return [...container.querySelectorAll("text")].map((node) => node.textContent ?? "");
}

describe("seatHoldersOf", () => {
  /**
   * **The morning this is about.** Six places, six booked, one diver does not
   * show, the staffer marks them no-show — which releases the seat — and a
   * walk-up buys it at the counter. Seven non-cancelled rows, six places. The
   * hull draws one seat per *place*, so before this filter the newest booking
   * (the person standing on the dock) was the row that fell off the picture,
   * and nothing anywhere noticed.
   */
  it("drops a released seat, so the roster can never outgrow the boat", () => {
    const roster = [
      entry({ id: "1", name: "Reef Nakamura", status: "booked" }),
      entry({ id: "2", name: "Hannah Liu", status: "checked_in" }),
      entry({ id: "3", name: "Ben Carter", status: "booked" }),
      entry({ id: "4", name: "Grace Mensah", status: "booked" }),
      entry({ id: "5", name: "Priya Sharma", status: "booked" }),
      entry({ id: "6", name: "Tomás Ferreira", status: "no_show" }),
      entry({ id: "7", name: "Jonas Berg", status: "booked" }),
    ];
    const held = seatHoldersOf(roster);
    expect(held).toHaveLength(6);
    expect(held.map((row) => row.person.fullName)).toContain("Jonas Berg");
    expect(held.map((row) => row.person.fullName)).not.toContain("Tomás Ferreira");
  });

  it("is the predicate capacity counts, not `not cancelled`", () => {
    const roster = [
      entry({ id: "1", name: "Reef Nakamura", status: "booked" }),
      entry({ id: "2", name: "Hannah Liu", status: "checked_in" }),
      entry({ id: "3", name: "Tomás Ferreira", status: "no_show" }),
    ];
    // Both seat-held statuses are drawn and the released one is not — the same
    // two the booking transaction enforces capacity over, so a boat can never
    // read full over a seat that is free.
    expect(seatHoldersOf(roster).map((row) => row.booking.status)).toEqual([
      "booked",
      "checked_in",
    ]);
  });
});

describe("TripHull", () => {
  it("draws one seat per place, and never more seats than the boat has", () => {
    const roster = Array.from({ length: 7 }, (_, index) =>
      entry({
        id: String(index),
        name: `Diver ${index}`,
        status: index === 5 ? "no_show" : "booked",
      }),
    );
    const { container } = render(
      <TripHull
        roster={roster}
        readinessByBooking={ready}
        capacity={6}
        color={null}
        label="Mantis I, drawn as its seats."
      />,
    );
    expect(seatsOf(container)).toHaveLength(6);
    // Six held bookings and six places: nobody on the roster is missing from
    // the picture, and no place is drawn that the boat does not have.
    expect(lettersOf(container)).toHaveLength(6);
  });

  /**
   * **Three readings, because there are three** (ADR 20260919-one-idea §3b.5).
   *
   * This test used to be called "paints an unread readiness as no refusal",
   * and it passed: `rosterRowIsBlocked` fails open, so a booking with no
   * readiness row painted as an ordinary held seat. That is the picture saying
   * *fine* where the truth is *nobody looked*, and on the one drawing a crew
   * reads to decide who gets on a boat it is the wrong way to be wrong.
   *
   * A refusal, a clearance and a silence are now three different seats, and
   * the one that matters is that the third is not the second.
   */
  it("tells a refusal, a clearance and an unread readiness apart", () => {
    const roster = [
      entry({ id: "1", name: "Grace Mensah", status: "booked" }),
      entry({ id: "2", name: "Hannah Liu", status: "booked" }),
      entry({ id: "3", name: "Noor Rahim", status: "booked" }),
    ];
    const readiness: ReadinessByBooking = new Map([
      ["1", { readiness: { status: "blocked" } } as ReadinessRow],
      ["2", { readiness: { status: "ready" } } as ReadinessRow],
      // "3" is absent: the readiness read never happened for that seat.
    ]);
    const { container } = render(
      <TripHull
        roster={roster}
        readinessByBooking={readiness}
        capacity={3}
        color={null}
        label="Mantis I, drawn as its seats."
      />,
    );
    const seats = seatsOf(container);
    expect(seats.map((node) => node.getAttribute("fill"))).toEqual([
      "var(--danger-tint)",
      "var(--surface)",
      "var(--surface)",
    ]);
    // The fill is shared with a cleared seat on purpose — nobody has refused
    // this diver either. The line is what carries the doubt, and it has to,
    // because the fill cannot without claiming something nobody said.
    expect(seats[1]?.getAttribute("stroke-dasharray")).toBeNull();
    expect(seats[2]?.getAttribute("stroke-dasharray")).toBe("3 3");
  });

  /**
   * A name in a script with no spaces takes its first two *characters*, which
   * `slice` gets wrong for anything outside the BMP: half a surrogate pair is a
   * broken glyph on a seat, and a broken glyph on a boat is the kind of thing
   * nobody reports and everybody stops trusting.
   */
  it("shortens a name without cutting a character in half", () => {
    const roster = [
      entry({ id: "1", name: "Hannah Liu", status: "booked" }),
      entry({ id: "2", name: "𝒜𝒷𝒸", status: "booked" }),
      entry({ id: "3", name: "Madonna", status: "booked" }),
    ];
    const { container } = render(
      <TripHull
        roster={roster}
        readinessByBooking={ready}
        capacity={3}
        color={null}
        label="Mantis I, drawn as its seats."
      />,
    );
    expect(lettersOf(container)).toEqual(["HL", "𝒜𝒷", "MA"]);
  });

  it("seats the guides in the wheelhouse when the departure has any", () => {
    const { container } = render(
      <TripHull
        roster={[entry({ id: "1", name: "Hannah Liu", status: "booked" })]}
        readinessByBooking={ready}
        capacity={4}
        color={null}
        crew={["Keiko Tanaka"]}
        label="Mantis I, drawn as its seats."
      />,
    );
    expect(lettersOf(container)).toContain("KT");
  });
});
