// @vitest-environment jsdom
// i18n-exempt-file: test fixture names are seeded data.

import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  chooseGuestAction,
  entry,
  openGuestMenu,
  readinessRow,
  renderRoster,
  signedWaiver,
} from "./roster-test-fixtures";
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
    acts: new Map(
      ids.map((id) => [
        id,
        [{ key: "not-here", label: "Not here", sheet: <p>Release this seat?</p> }],
      ]),
    ),
    boarded: new Set<string>(),
  };
}

const group = (key: string) => document.querySelector(`[data-fix-group="${key}"]`) as HTMLElement;

describe("a row says the name, one phrase, and one button", () => {
  it("says a waiver nobody could be sent was not sent, and hands over the counter code", () => {
    const pending = new Map([
      ["n", readinessRow("blocked", [{ code: "waiver_pending", params: undefined }])],
      ["m", readinessRow("blocked", [{ code: "waiver_pending", params: undefined }])],
    ]) as ReadinessByBooking;
    const nameOnly = entry("n", "Nadia Nocontact");
    renderRoster({
      roster: [
        { ...nameOnly, person: { ...nameOnly.person, email: null, phone: null } },
        entry("m", "Mateo Mailed"),
      ],
      readiness: pending,
      waivers: new Map() as WaiverByBooking,
      selectedBookingId: null,
      phase: "ready",
    });
    const cantBoard = group("cantBoard");
    expect(
      within(cantBoard).getByRole("button", { name: "Nadia Nocontact" }),
    ).toHaveAccessibleDescription("Waiver unsigned, nothing could be sent");
    expect(within(cantBoard).getByRole("link", { name: "Sign at the counter" })).toHaveAttribute(
      "href",
      "/shop/blue-mantis/trips/trip-1/party/n/waivers",
    );
    // An emailed guest's waiver is still the one sent and not signed.
    expect(
      within(cantBoard).getByRole("button", { name: "Mateo Mailed" }),
    ).toHaveAccessibleDescription("Waiver sent, not signed");
  });

  it("counts a guest on a shared inbox as reached: the seat's mail goes there", () => {
    const leo = entry("l", "Leo Lopez");
    renderRoster({
      roster: [
        {
          ...leo,
          booking: { ...leo.booking, deliveryEmail: "a@x.com" },
          person: { ...leo.person, email: null, phone: null },
        },
      ],
      readiness: new Map([
        ["l", readinessRow("blocked", [{ code: "waiver_pending", params: undefined }])],
      ]) as ReadinessByBooking,
      waivers: new Map() as WaiverByBooking,
      selectedBookingId: null,
      phase: "ready",
    });
    const cantBoard = group("cantBoard");
    expect(
      within(cantBoard).getByRole("button", { name: "Leo Lopez" }),
    ).toHaveAccessibleDescription("Waiver sent, not signed");
    expect(within(cantBoard).queryByRole("link", { name: "Sign at the counter" })).toBeNull();
  });

  it("puts a blocked guest under Can't board yet with the one remedy", () => {
    renderRoster({
      roster: [blocked, ready],
      readiness: blockers,
      waivers,
      selectedBookingId: null,
      phase: "ready",
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
      phase: "ready",
    });
    expect(group("cantBoard")).toBeNull();
    const worth = group("worth");
    expect(within(worth).getByRole("button", { name: "Olga Rust" })).toHaveAccessibleDescription(
      "Hasn’t dived in a while · Fit gear at check-in",
    );
  });

  it("lists everyone booked, with nothing to fix, once the boat has left", () => {
    const rusty = entry("r", "Olga Rust");
    renderRoster({
      roster: [
        { ...rusty, booking: { ...rusty.booking, lastDivedBand: "over_five_years" } },
        blocked,
      ],
      readiness: new Map([
        ["r", readinessRow("ready")],
        ["a", readinessRow("blocked", [{ code: "waiver_not_sent", params: undefined }])],
      ]) as ReadinessByBooking,
      waivers,
      arrival: desk(["r", "a"]),
      selectedBookingId: null,
      phase: "listed",
    });
    expect(group("worth")).toBeNull();
    expect(group("cantBoard")).toBeNull();
    expect(group("booked")).toHaveTextContent("Booked · Olga Rust and Priya Sharma");
    // No desk tap and no fix: the boat has left.
    expect(screen.queryByRole("button", { name: "Check in" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Send waiver" })).toBeNull();
  });

  it("offers no arrival undo after departure even if a desk control exists", () => {
    const arrived = entry("h", "Hana Ito", { checkedIn: true });
    const arrival = desk(["h"]);
    arrival.controls.set("h", <button type="button">Undo Hana’s check-in</button>);
    renderRoster({
      roster: [arrived],
      readiness: new Map([["h", readinessRow("ready")]]) as ReadinessByBooking,
      waivers: new Map([["h", signedWaiver]]) as WaiverByBooking,
      arrival,
      phase: "listed",
      selectedBookingId: null,
    });
    expect(screen.queryByRole("button", { name: "Undo Hana’s check-in" })).toBeNull();
  });

  it("names each guest once, with all their reasons, and counts people", () => {
    const deep = (id: string, name: string) => {
      const row = entry(id, name);
      return { ...row, booking: { ...row.booking, lastDivedBand: "over_five_years" as const } };
    };
    renderRoster({
      roster: [deep("r", "Olga Rust"), deep("s", "Sam Whitfield")],
      readiness: new Map([
        ["r", readinessRow("ready")],
        ["s", readinessRow("ready")],
      ]) as ReadinessByBooking,
      waivers: new Map([
        ["r", signedWaiver],
        ["s", signedWaiver],
      ]) as WaiverByBooking,
      rentalFit: ownGear(["s"]),
      selectedBookingId: null,
      phase: "ready",
    });
    const worth = group("worth");
    expect(within(worth).getAllByRole("button", { name: /Olga Rust|Sam Whitfield/ })).toHaveLength(
      2,
    );
    expect(within(worth).getByText("2")).toBeVisible();
    expect(within(worth).getByRole("button", { name: "Olga Rust" })).toHaveAccessibleDescription(
      "Hasn’t dived in a while · Fit gear at check-in",
    );
    expect(
      within(worth).getByRole("button", { name: "Sam Whitfield" }),
    ).toHaveAccessibleDescription("Hasn’t dived in a while");
  });

  it("gives the list's first fix the one primary button", () => {
    const rusty = entry("r", "Olga Rust");
    renderRoster({
      roster: [
        blocked,
        { ...rusty, booking: { ...rusty.booking, lastDivedBand: "over_five_years" } },
      ],
      readiness: new Map([...blockers, ["r", readinessRow("ready")]]) as ReadinessByBooking,
      waivers: new Map([...waivers, ["r", signedWaiver]]) as WaiverByBooking,
      selectedBookingId: null,
      phase: "ready",
    });
    expect(within(group("cantBoard")).getByRole("link", { name: "Check cards" })).toHaveClass(
      "bg-primary",
    );
    for (const control of within(group("worth")).getAllByRole("button", { name: /Fit gear|Open/ }))
      expect(control).not.toHaveClass("bg-primary");
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
  it("keeps undo accessible for an arrived guest with an advisory", () => {
    const arrived = entry("h", "Hana Ito", { checkedIn: true });
    const arrival = desk(["h"]);
    arrival.controls.set("h", <button type="button">Undo Hana’s check-in</button>);
    renderRoster({
      roster: [
        {
          ...arrived,
          person: { ...arrived.person, emergencyContactName: null, emergencyContactPhone: null },
        },
      ],
      readiness: new Map([["h", readinessRow("ready")]]) as ReadinessByBooking,
      waivers: new Map([["h", signedWaiver]]) as WaiverByBooking,
      rentalFit: ownGear(["h"]),
      arrival,
      selectedBookingId: null,
    });
    const worth = group("worth");
    expect(within(worth).getAllByRole("button", { name: "Undo Hana’s check-in" })).toHaveLength(1);
    fireEvent.click(within(worth).getByRole("button", { name: "Hana Ito" }));
    expect(within(worth).getAllByRole("button", { name: "Undo Hana’s check-in" })).toHaveLength(1);
    expect(within(worth).getByText("Emergency contact · Not on file")).toBeVisible();
  });

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
      addGuestHref: "#add-a-booking",
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
    // The rare actions are one More menu, beside Close.
    expect(within(opened).queryByRole("button", { name: "Not here" })).toBeNull();
    const menu = openGuestMenu();
    expect(opened).toContainElement(menu);
    expect(within(menu).getByRole("link", { name: "Open guest profile" })).toBeVisible();
    // "Not here" asks its question in a sheet; the menu row posts nothing.
    const sheet = opened.querySelector('[data-guest-sheet="not-here"]') as HTMLElement;
    expect(sheet).not.toBeVisible();
    chooseGuestAction("Not here");
    expect(sheet).toBeVisible();
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
      phase: "ready",
    });
    fireEvent.click(screen.getByRole("button", { name: "Lena Fischer" }));
    expect(document.querySelectorAll("[data-opened-guest]")).toHaveLength(1);
    expect(document.querySelector('[data-opened-guest="b"]')).not.toBeNull();
  });
});

describe("an opened guest's facts", () => {
  it("names their email, and a minor's age", () => {
    const mia = entry("m", "Mia Young", { dateOfBirth: "2014-03-01" });
    renderRoster({
      roster: [mia],
      readiness: new Map([["m", readinessRow("ready")]]) as ReadinessByBooking,
      waivers: new Map([["m", signedWaiver]]) as WaiverByBooking,
      selectedBookingId: "m",
      phase: "ready",
    });
    const opened = document.querySelector('[data-opened-guest="m"]') as HTMLElement;
    expect(within(opened).getByText("m@example.com")).toBeVisible();
    expect(within(opened).getByText("Age")).toBeVisible();
  });

  it("gives an adult no age line", () => {
    const ada = entry("d", "Ada Grown", { dateOfBirth: "1980-03-01" });
    renderRoster({
      roster: [ada],
      readiness: new Map([["d", readinessRow("ready")]]) as ReadinessByBooking,
      waivers: new Map([["d", signedWaiver]]) as WaiverByBooking,
      selectedBookingId: "d",
      phase: "ready",
    });
    const opened = document.querySelector('[data-opened-guest="d"]') as HTMLElement;
    expect(within(opened).getByText("d@example.com")).toBeVisible();
    expect(within(opened).queryByText("Age")).toBeNull();
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
      phase: "listed",
    });
    expect(screen.queryByRole("button", { name: "Check in" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Add a guest" })).toBeNull();
    // Nothing to make ready on a trip that will not sail.
    expect(group("cantBoard")).toBeNull();
    expect(group("booked")).toHaveTextContent("Booked · Priya Sharma and Lena Fischer");
  });
});

/** Domain review 2, ruling: with no roll call, Wrapped up lists guests plainly, no fixes. */
describe("a wrapped trip with no roll call", () => {
  it("lists every guest by name, with no fix and no Worth a minute", () => {
    renderRoster({
      roster: [blocked, ready] as RosterEntry[],
      readiness: blockers,
      waivers,
      rentalFit: ownGear(["a", "b"]),
      selectedBookingId: null,
      phase: "listed",
    });
    expect(group("cantBoard")).toBeNull();
    expect(group("worth")).toBeNull();
    const booked = group("booked");
    fireEvent.click(within(booked).getByRole("button", { expanded: false }));
    expect(within(booked).getByRole("button", { name: "Lena Fischer" })).toBeVisible();
  });
});

/** Domain review of layer B, F2: at Check-in the crew can read what the guest asked for. */
describe("a guest easing back in, at Check-in", () => {
  it("names the ask on the row and says it in full in the opened guest", () => {
    const ivo = entry("i", "Ivo Marsh");
    renderRoster({
      roster: [{ ...ivo, booking: { ...ivo.booking, reEntryAsk: "easy_first_dive" } }],
      readiness: new Map([["i", readinessRow("ready")]]) as ReadinessByBooking,
      waivers: new Map([["i", signedWaiver]]) as WaiverByBooking,
      rentalFit: ownGear(["i"]),
      arrival: desk(["i"]),
      selectedBookingId: null,
    });
    expect(
      within(group("toCome")).getByRole("button", { name: "Ivo Marsh" }),
    ).toHaveAccessibleDescription("Wants an easy first dive");
    fireEvent.click(screen.getByRole("button", { name: "Ivo Marsh" }));
    const opened = document.querySelector('[data-opened-guest="i"]') as HTMLElement;
    expect(within(opened).getByText("Asked for an easy first dive.")).toBeVisible();
  });
});

/** Domain review of layer B, F3: a blocked guest who already arrived says so. */
describe("a blocked guest who is already here", () => {
  it("leads the phrase with Here", () => {
    const arrived = entry("h", "Hana Ito", { checkedIn: true });
    renderRoster({
      roster: [arrived],
      readiness: new Map([
        ["h", readinessRow("blocked", [{ code: "certification_missing", params: undefined }])],
      ]) as ReadinessByBooking,
      waivers: new Map([["h", signedWaiver]]) as WaiverByBooking,
      rentalFit: ownGear(["h"]),
      arrival: desk(["h"]),
      selectedBookingId: null,
    });
    expect(
      within(group("cantBoard")).getByRole("button", { name: "Hana Ito" }),
    ).toHaveAccessibleDescription("Here · No card on file");
  });

  it("keeps both the remedy and exactly one undo before and after opening", () => {
    const arrived = entry("h", "Hana Ito", { checkedIn: true });
    const arrival = desk(["h"]);
    arrival.controls.set("h", <button type="button">Undo Hana’s check-in</button>);
    renderRoster({
      roster: [arrived],
      readiness: new Map([
        ["h", readinessRow("blocked", [{ code: "certification_missing", params: undefined }])],
      ]) as ReadinessByBooking,
      waivers: new Map([["h", signedWaiver]]) as WaiverByBooking,
      rentalFit: ownGear(["h"]),
      arrival,
      selectedBookingId: null,
    });
    const section = group("cantBoard");
    expect(within(section).getByRole("link", { name: "Check cards" })).toBeVisible();
    expect(within(section).getAllByRole("button", { name: "Undo Hana’s check-in" })).toHaveLength(
      1,
    );
    fireEvent.click(within(section).getByRole("button", { name: "Hana Ito" }));
    expect(within(section).getAllByRole("button", { name: "Undo Hana’s check-in" })).toHaveLength(
      1,
    );
  });
});

/** Getting ready (ADR 20261117-trip-page-clock): remote remedies, settled things folded. */
describe("the day before", () => {
  it("folds everyone ready into one line, with crew and plan set beneath it", () => {
    renderRoster({
      roster: [ready, entry("c", "Cleo Stone")],
      readiness: new Map([
        ["b", readinessRow("ready")],
        ["c", readinessRow("ready")],
      ]) as ReadinessByBooking,
      waivers: new Map([
        ["b", signedWaiver],
        ["c", signedWaiver],
      ]) as WaiverByBooking,
      rentalFit: ownGear(["b", "c"]),
      phase: "ready",
      afterReady: <p>Crew and plan are set · Sal · Blue Hole</p>,
      selectedBookingId: null,
    });
    expect(group("cantBoard")).toBeNull();
    expect(screen.getByText("2 guests are ready")).toBeVisible();
    expect(screen.getByText("Crew and plan are set · Sal · Blue Hole")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Check in" })).toBeNull();
  });

  it("puts a trip with no crew on the list, with the door to set it", () => {
    renderRoster({
      roster: [ready],
      readiness: new Map([["b", readinessRow("ready")]]) as ReadinessByBooking,
      waivers: new Map([["b", signedWaiver]]) as WaiverByBooking,
      rentalFit: ownGear(["b"]),
      phase: "ready",
      tripFixes: [
        {
          key: "noCrew",
          text: "No crew yet",
          tone: "warning",
          action: { href: "/trip?view=edit#crew", label: "Set crew" },
        },
      ],
      selectedBookingId: null,
    });
    const worth = group("worth");
    expect(within(worth).getByText("No crew yet")).toBeVisible();
    expect(within(worth).getByRole("link", { name: "Set crew" })).toHaveAttribute(
      "href",
      "/trip?view=edit#crew",
    );
  });
});

/** Filling: days ahead, nothing is urgent, so each reason is said quietly. */
describe("while the trip fills", () => {
  it("lists who needs something later under Booked, with no remedy button", () => {
    renderRoster({
      roster: [blocked, ready],
      readiness: blockers,
      waivers,
      rentalFit: ownGear(["a", "b"]),
      phase: "filling",
      selectedBookingId: null,
    });
    const booked = group("booked");
    expect(within(booked).getByText("Booked")).toBeVisible();
    expect(within(booked).getByRole("button", { name: "Priya Sharma" })).toBeVisible();
    expect(within(booked).queryByRole("link", { name: "Check cards" })).toBeNull();
    expect(within(booked).getByText(/Nothing needed from them yet/)).toBeVisible();
  });

  it("says a reminder time the card shares once, on its heading row", () => {
    const at = new Date("2026-11-29T13:00:00.000Z");
    renderRoster({
      roster: [blocked, entry("c", "Cora Dunn")],
      reminders: new Map([
        ["a", at],
        ["c", at],
      ]),
      readiness: new Map([
        ["a", readinessRow("blocked", [{ code: "certification_missing", params: undefined }])],
        ["c", readinessRow("blocked", [{ code: "waiver_not_sent", params: undefined }])],
      ]) as ReadinessByBooking,
      waivers: new Map() as WaiverByBooking,
      rentalFit: ownGear(["a", "c"]),
      phase: "filling",
      selectedBookingId: null,
    });
    const booked = group("booked") as HTMLElement;
    expect(within(booked).getAllByText(/Reminder goes out/)).toHaveLength(1);
    expect(document.getElementById("guest-phrase-a")).not.toHaveTextContent("Reminder");
  });

  it("draws no Add a guest of its own: the page's primary is beside the sentence", () => {
    renderRoster({
      roster: [blocked, ready],
      readiness: blockers,
      waivers,
      rentalFit: ownGear(["a", "b"]),
      phase: "filling",
      selectedBookingId: null,
      addGuestHref: "/trip?phase=filling&add=1#add-a-booking",
    });
    expect(screen.getByRole("button", { name: "Priya Sharma" })).toBeVisible();
    expect(screen.queryByRole("link", { name: "Add a guest" })).toBeNull();
  });

  // Fails closed, as the sentence does (`tripFrame`): a seat the read missed is never "fine".
  it("lists a seat with no readiness reading as needing a look, as the sentence counts it", () => {
    const readiness = new Map([
      ["a", readinessRow("blocked", [{ code: "certification_missing", params: undefined }])],
    ]) as ReadinessByBooking;
    const roster = [blocked, ready];
    renderRoster({
      roster,
      readiness,
      waivers,
      rentalFit: ownGear(["a", "b"]),
      phase: "filling",
      selectedBookingId: null,
    });
    // The sentence's count: anyone whose reading is not "ready".
    const notReady = roster.filter(
      ({ booking }) => readiness.get(booking.id)?.readiness?.status !== "ready",
    ).length;
    const booked = group("booked") as HTMLElement;
    const warned = [...booked.querySelectorAll("[id^='guest-phrase-']")].filter((line) =>
      line.classList.contains("text-warning-strong"),
    );
    expect(notReady).toBe(2);
    expect(warned).toHaveLength(notReady);
    expect(document.getElementById("guest-phrase-b")).toHaveTextContent("Couldn’t check readiness");
    expect(within(booked).queryByText(/Nothing needed from them yet/)).toBeNull();
  });

  it("says in the warning color only what would stop a guest boarding", () => {
    const rusty = entry("r", "Olga Rust");
    renderRoster({
      roster: [
        blocked,
        { ...rusty, booking: { ...rusty.booking, lastDivedBand: "over_five_years" } },
      ],
      readiness: new Map([
        ["a", readinessRow("blocked", [{ code: "waiver_not_sent", params: undefined }])],
        ["r", readinessRow("ready")],
      ]) as ReadinessByBooking,
      waivers: new Map([["r", signedWaiver]]) as WaiverByBooking,
      rentalFit: ownGear(["a", "r"]),
      phase: "filling",
      selectedBookingId: null,
    });
    expect(document.getElementById("guest-phrase-a")).toHaveClass("text-warning-strong");
    // Worth a minute, days ahead: said, quietly.
    const advisory = document.getElementById("guest-phrase-r");
    expect(advisory).toHaveClass("text-muted");
    expect(advisory).not.toHaveClass("text-warning-strong");
  });

  const rusty = (id: string, name: string) => {
    const guest = entry(id, name);
    return { ...guest, booking: { ...guest.booking, lastDivedBand: "over_five_years" as const } };
  };

  it("says a quiet line every guest shares once, on the heading row, not on each row", () => {
    renderRoster({
      roster: [rusty("r", "Olga Rust"), rusty("s", "Sam Rust")],
      readiness: new Map([
        ["r", readinessRow("ready")],
        ["s", readinessRow("ready")],
      ]) as ReadinessByBooking,
      waivers: new Map([
        ["r", signedWaiver],
        ["s", signedWaiver],
      ]) as WaiverByBooking,
      rentalFit: ownGear(["r", "s"]),
      phase: "filling",
      selectedBookingId: null,
    });
    const booked = group("booked") as HTMLElement;
    const said = within(booked).getAllByText(/^Everyone: /);
    expect(said).toHaveLength(1);
    const line = (said[0]?.textContent ?? "").replace(/^Everyone: /, "");
    expect(line.length).toBeGreaterThan(0);
    // Both guests are still listed by name; neither row repeats the line.
    expect(within(booked).getByRole("button", { name: "Olga Rust" })).toBeVisible();
    expect(within(booked).getByRole("button", { name: "Sam Rust" })).toBeVisible();
    for (const id of ["r", "s"]) {
      expect(document.getElementById(`guest-phrase-${id}`)?.textContent ?? "").not.toContain(line);
    }
  });

  it("never folds what would stop a guest boarding: the blocker stays on its row, in warning", () => {
    renderRoster({
      roster: [rusty("a", "Priya Sharma"), rusty("r", "Olga Rust")],
      readiness: new Map([
        ["a", readinessRow("blocked", [{ code: "waiver_not_sent", params: undefined }])],
        ["r", readinessRow("ready")],
      ]) as ReadinessByBooking,
      waivers: new Map([["r", signedWaiver]]) as WaiverByBooking,
      rentalFit: ownGear(["a", "r"]),
      phase: "filling",
      selectedBookingId: null,
    });
    const blocker = document.getElementById("guest-phrase-a");
    expect(blocker).toHaveClass("text-warning-strong");
    expect(blocker?.textContent ?? "").not.toBe("");
    // Whatever the heading row says for everyone, it is never the blocker.
    for (const shared of screen.queryAllByText(/^Everyone: /)) {
      expect(shared.textContent).not.toContain(blocker?.textContent ?? "x");
    }
  });

  it("keeps the line on its row when not every guest shares it", () => {
    renderRoster({
      roster: [rusty("r", "Olga Rust"), ready],
      readiness: new Map([
        ["r", readinessRow("ready")],
        ["b", readinessRow("ready")],
      ]) as ReadinessByBooking,
      waivers: new Map([
        ["r", signedWaiver],
        ["b", signedWaiver],
      ]) as WaiverByBooking,
      rentalFit: ownGear(["r", "b"]),
      phase: "filling",
      selectedBookingId: null,
    });
    expect(screen.queryByText(/^Everyone: /)).toBeNull();
    expect(document.getElementById("guest-phrase-r")?.textContent ?? "").not.toBe("");
  });
});
