// @vitest-environment jsdom
// i18n-exempt-file: test fixture names are seeded data.

import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { entry, readinessRow, renderRoster, signedWaiver } from "./roster-test-fixtures";
import type { ReadinessByBooking, RentalFitByBooking, RosterEntry, WaiverByBooking } from "./types";

/** A fit stated and renting nothing: no gear to fit. */
const ownGear = (ids: string[]) =>
  new Map(
    ids.map((id) => [id, { fitStatedAt: new Date("2026-08-01T00:00:00Z") }]),
  ) as unknown as RentalFitByBooking;

afterEach(cleanup);

const blocked = entry("a", "Priya Sharma");
const ready = entry("b", "Lena Fischer");
const blockers = new Map([
  ["a", readinessRow("blocked", [{ code: "certification_missing", params: undefined }])],
  ["b", readinessRow("ready")],
]) as ReadinessByBooking;
const waivers = new Map([
  ["a", signedWaiver],
  ["b", signedWaiver],
]) as WaiverByBooking;

/** The desk's taps, as `buildArrivalDesk` hands them to the list. */
function desk(ids: string[], below = new Map()) {
  return {
    controls: new Map(
      ids.map((id) => [
        id,
        <button key={id} type="button">
          Check in
        </button>,
      ]),
    ),
    below,
    details: new Map(
      ids.map((id) => [
        id,
        <button key={id} type="button">
          Not here
        </button>,
      ]),
    ),
    boarded: new Set<string>(),
  };
}

const group = (key: string) => document.querySelector(`[data-fix-group="${key}"]`) as HTMLElement;

describe("a row says the name, one phrase, and one button", () => {
  it("puts a blocked guest under Can't board yet with the one remedy", () => {
    renderRoster({
      roster: [blocked, ready],
      readiness: blockers,
      waivers,
      selectedBookingId: null,
    });
    const cantBoard = group("cantBoard");
    expect(within(cantBoard).getByText("Can’t board yet")).toBeVisible();
    expect(
      within(cantBoard).getByRole("button", { name: "Priya Sharma" }),
    ).toHaveAccessibleDescription("No card on file");
    expect(within(cantBoard).getByRole("link", { name: "Check cards" })).toHaveAttribute(
      "href",
      "/shop/blue-mantis/divers/p-a#cards",
    );
    // The full sentence waits on the opened guest.
    expect(screen.queryByText("No certification is on file for this trip.")).toBeNull();
  });

  it("files a guest with only an advisory under Worth a minute, never as blocked", () => {
    const rusty = entry("r", "Olga Rust");
    renderRoster({
      roster: [{ ...rusty, booking: { ...rusty.booking, lastDivedBand: "over_five_years" } }],
      readiness: new Map([["r", readinessRow("ready")]]) as ReadinessByBooking,
      waivers: new Map([["r", signedWaiver]]) as WaiverByBooking,
      selectedBookingId: null,
    });
    expect(group("cantBoard")).toBeNull();
    const worth = group("worth");
    expect(within(worth).getByRole("button", { name: "Olga Rust" })).toHaveAccessibleDescription(
      "Hasn’t dived in a while · 1 more",
    );
  });

  it("says a snorkeler and the party they come with in the one phrase", () => {
    const mara = entry("m", "Mara Quint", { participantType: "snorkeler" });
    const owen = entry("o", "Owen Quint");
    (owen.booking as { partyLeadBookingId: string | null }).partyLeadBookingId = "m";
    renderRoster({
      roster: [mara, owen],
      readiness: new Map([
        ["m", readinessRow("ready")],
        ["o", readinessRow("ready")],
      ]) as ReadinessByBooking,
      waivers: new Map([
        ["m", signedWaiver],
        ["o", signedWaiver],
      ]) as WaiverByBooking,
      rentalFit: ownGear(["m", "o"]),
      arrival: desk(["m", "o"]),
      selectedBookingId: null,
    });
    const toCome = group("toCome");
    expect(within(toCome).getByRole("button", { name: "Mara Quint" })).toHaveAccessibleDescription(
      "Snorkeler · with Owen Quint",
    );
    expect(within(toCome).getByRole("button", { name: "Owen Quint" })).toHaveAccessibleDescription(
      "with Mara Quint",
    );
  });
});

describe("at Check-in", () => {
  it("gives each guest to come the desk's Check in, and folds who is here into one line", () => {
    const june = entry("j", "June Park", { checkedIn: true });
    renderRoster({
      roster: [ready, june],
      readiness: new Map([
        ["b", readinessRow("ready")],
        ["j", readinessRow("ready")],
      ]) as ReadinessByBooking,
      waivers: new Map([
        ["b", signedWaiver],
        ["j", signedWaiver],
      ]) as WaiverByBooking,
      rentalFit: ownGear(["b", "j"]),
      arrival: desk(["b", "j"]),
      addDiverGroup: <p>add</p>,
      selectedBookingId: null,
    });
    expect(within(group("toCome")).getByRole("button", { name: "Check in" })).toBeVisible();
    const here = group("fine");
    expect(here).toHaveTextContent("Here · June Park");
    expect(within(here).queryByRole("button", { name: "June Park" })).toBeNull();
    expect(within(here).getByRole("link", { name: "Add a guest" })).toHaveAttribute(
      "href",
      "#add-a-booking",
    );
    fireEvent.click(within(here).getByRole("button", { expanded: false }));
    expect(within(here).getByRole("button", { name: "June Park" })).toBeVisible();
  });
});

describe("a guest opened in place", () => {
  it("keeps every other guest on the page, and holds the rare actions", () => {
    renderRoster({
      roster: [blocked, ready],
      readiness: blockers,
      waivers,
      arrival: desk(["a", "b"]),
      selectedBookingId: "a",
    });
    const opened = document.querySelector("li#booking-a") as HTMLElement;
    expect(within(opened).getByText("No certification is on file for this trip.")).toBeVisible();
    expect(within(opened).getByRole("button", { name: "Not here" })).toBeVisible();
    expect(within(opened).getByRole("link", { name: "Open guest profile" })).toBeVisible();
    // The rest of the list stays put.
    expect(screen.getByRole("button", { name: "Lena Fischer" })).toBeVisible();
    expect(window.location.hash).toBe("#booking-a");
    fireEvent.click(within(opened).getByRole("button", { name: "Close" }));
    expect(document.querySelector("[data-opened-guest]")).toBeNull();
  });

  it("opens one guest at a time", () => {
    renderRoster({
      roster: [blocked, ready],
      readiness: blockers,
      waivers,
      selectedBookingId: "a",
    });
    fireEvent.click(screen.getByRole("button", { name: "Lena Fischer" }));
    expect(document.querySelectorAll("[data-opened-guest]")).toHaveLength(1);
    expect(document.querySelector('[data-opened-guest="b"]')).not.toBeNull();
  });

  it("leaves the wait list's offers beside the list while a guest is open", () => {
    renderRoster({
      roster: [blocked],
      readiness: blockers,
      waivers,
      whoWantsInGroup: <section aria-label="Who wants in">Ravi Menon · Offer a seat</section>,
      selectedBookingId: "a",
    });
    expect(screen.getByRole("region", { name: "Who wants in" })).toBeVisible();
  });
});

describe("a cancelled trip", () => {
  it("lists every guest with no Check in and no way to add one", () => {
    renderRoster({
      roster: [blocked, ready] as RosterEntry[],
      readiness: blockers,
      waivers,
      rentalFit: ownGear(["a", "b"]),
      selectedBookingId: null,
    });
    expect(screen.queryByRole("button", { name: "Check in" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Add a guest" })).toBeNull();
    expect(group("cantBoard")).not.toBeNull();
    expect(group("fine")).toHaveTextContent("Everyone else · Lena Fischer");
  });
});
