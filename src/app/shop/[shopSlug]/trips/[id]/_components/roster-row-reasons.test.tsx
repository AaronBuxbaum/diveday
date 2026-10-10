// @vitest-environment jsdom

import { cleanup, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { entry, fixtures, readinessRow, renderRoster, signedWaiver } from "./roster-test-fixtures";
import type { ReadinessByBooking, RentalFitByBooking, WaiverByBooking } from "./types";

afterEach(cleanup);

/**
 * A drysuit is the one rental that changes how a diver ascends, and DiveDay
 * already records who holds the specialty — so the roster says when the suit
 * and the card have come apart (`dive-domain-expert` review, 2026-09-12).
 * Never a gate: the sentence is warning tone beside the depth advisory, and
 * `src/lib/drysuit-card.test.ts` pins that readiness cannot see it.
 */
describe("a diver in a drysuit with no drysuit card", () => {
  const diver = entry("d", "Ines Kowalski");
  const drysuitFit = (rentsDrysuit: boolean, divesDry = rentsDrysuit) =>
    new Map([
      [
        "d",
        {
          rentsDrysuit,
          divesDry,
          drysuitSize: rentsDrysuit ? "ML" : null,
          rentsBcd: false,
          rentsRegulator: false,
          rentsWetsuit: false,
          rentsMaskFins: false,
          rentsWeights: false,
          rentsDiveComputer: false,
          rentsGopro: false,
          rentsHood: false,
          rentsGloves: false,
          rentsTorch: false,
          rentsSmb: false,
          bcdSize: null,
          wetsuitSize: null,
          bootSize: null,
          finSize: null,
          weightPreference: null,
          needsStaffFitAt: null,
          needsStaffFitNote: null,
        },
      ],
    ]) as unknown as RentalFitByBooking;

  const withCards = (cards: unknown[]) =>
    new Map([
      [
        "d",
        {
          ...readinessRow("ready"),
          specialtyCertifications: cards,
        } as unknown as ReadinessByBooking extends Map<string, infer V> ? V : never,
      ],
    ]) as ReadinessByBooking;

  const waivers = new Map([["d", signedWaiver]]) as WaiverByBooking;

  it("names the gap, and says in the sentence that nothing is blocked", () => {
    renderRoster({
      roster: [diver],
      readiness: withCards([]),
      waivers,
      rentalFit: drysuitFit(true),
    });

    expect(
      screen.getByText(
        "Dives dry with no drysuit certification on file. Not a block: ask about their drysuit experience, or plan an orientation before the first dive.",
      ),
    ).toBeInTheDocument();
    // The advisory is not a blocker, so the seat is still cleared.
    expect(screen.queryByText("Blocked")).toBeNull();
  });

  it("names it for a diver in their own suit, who rents none from us (H-78)", () => {
    // Most drysuit divers own the suit. The advisory used to ask whether the
    // shop was renting one, which left silent exactly the divers it is about
    // (issue #1752).
    renderRoster({
      roster: [diver],
      readiness: withCards([]),
      waivers,
      rentalFit: drysuitFit(false, true),
    });

    expect(screen.getByText(/^Dives dry with no drysuit certification on file/)).toBeVisible();
  });

  it("says nothing when the diver holds the card", () => {
    renderRoster({
      roster: [diver],
      readiness: withCards([
        { specialty: "drysuit", status: "verified", importedAt: null, reviewedAt: null },
      ]),
      waivers,
      rentalFit: drysuitFit(true),
    });

    expect(screen.queryByText(/drysuit certification/)).toBeNull();
  });

  it("says nothing about a diver who is not in one", () => {
    renderRoster({
      roster: [diver],
      readiness: withCards([]),
      waivers,
      rentalFit: drysuitFit(false),
    });

    expect(screen.queryByText(/drysuit certification/)).toBeNull();
  });
});

/**
 * **A missing emergency contact is said once, under the name** (owner,
 * 2026-10-05). The sentence is one of the row's reason lines; the form waits
 * behind the row under its own "Add emergency contact".
 */
describe("the missing emergency contact line", () => {
  it("states the gap under the name and keeps the form behind the row", () => {
    renderRoster({
      ...fixtures,
      roster: [entry("e", "Noor Haddad", { emergencyContactName: "", emergencyContactPhone: "" })],
      readiness: new Map([["e", readinessRow("ready")]]) as ReadinessByBooking,
      waivers: new Map([["e", signedWaiver]]) as WaiverByBooking,
    });

    expect(screen.getByText("Emergency contact · Not on file")).toBeVisible();
    expect(screen.getAllByText("Emergency contact · Not on file")).toHaveLength(1);
    expect(screen.getByText("Add emergency contact")).not.toBeVisible();
  });
});

/**
 * **A new release can clear a diver a physician refused, and the row says so**
 * (Aaron, 2026-10-07, issue #2158: "allow a waiver without, but show a warning
 * that a previous waiver had a physician say no (with link)").
 */
describe("an earlier physician refusal under a cleared release", () => {
  const refusedRow = (status: "ready" | "blocked" = "ready") =>
    ({
      ...readinessRow(status),
      overriddenRefusal: { recordId: "w-refused", at: new Date("2026-08-01T15:00:00Z") },
    }) as unknown as ReadinessByBooking extends Map<string, infer V> ? V : never;

  it("warns in the open on a Ready row, with a link to the refused record", () => {
    renderRoster({
      ...fixtures,
      roster: [entry("r", "Noor Haddad")],
      readiness: new Map([["r", refusedRow()]]) as ReadinessByBooking,
      waivers: new Map([["r", signedWaiver]]) as WaiverByBooking,
    });

    const line = screen.getByText(/A physician did not clear this diver on/);
    expect(line).toBeVisible();
    expect(line.textContent).toMatch(/Aug\s1 \(earlier waiver\)/);
    const link = within(line.closest("li") as HTMLElement).getByRole("link", {
      name: "View signed record",
    });
    expect(link).toHaveAttribute("href", "/shop/blue-mantis/divers/p-r/waivers/w-refused");
  });

  it("says nothing on a held seat: the refusal is the matched person's history", () => {
    const held = entry("r", "Noor Haddad", { identityBookedAs: "Noor H." });
    (held.booking as { identityUnconfirmedAt: Date | null }).identityUnconfirmedAt = new Date(
      "2026-08-20T15:00:00Z",
    );
    renderRoster({
      ...fixtures,
      roster: [held],
      readiness: new Map([["r", refusedRow("blocked")]]) as ReadinessByBooking,
      waivers: new Map([["r", signedWaiver]]) as WaiverByBooking,
    });
    expect(screen.queryByText(/A physician did not clear this diver on/)).toBeNull();
  });
});

/**
 * **A clean release over a referral no physician answered: the seat clears,
 * and the row warns with a link back** (Aaron, 2026-10-09, issue #2195,
 * amending H-98). The same shape as the refusal above.
 */
describe("an unanswered referral under a cleared release", () => {
  const referredRow = (status: "ready" | "blocked" = "ready") =>
    ({
      ...readinessRow(status),
      overriddenReferralAt: new Date("2026-08-01T15:00:00Z"),
      overriddenReferral: {
        recordId: "w-referred",
        personId: "p-r",
        at: new Date("2026-08-01T15:00:00Z"),
      },
    }) as unknown as ReadinessByBooking extends Map<string, infer V> ? V : never;

  it("warns in the open on a Ready row, with a link to the referral", () => {
    renderRoster({
      ...fixtures,
      roster: [entry("r", "Noor Haddad")],
      readiness: new Map([["r", referredRow()]]) as ReadinessByBooking,
      waivers: new Map([["r", signedWaiver]]) as WaiverByBooking,
    });

    // Ready, not blocked: the override stands.
    expect(screen.getByRole("heading", { name: /^Ready/ })).toBeVisible();
    const line = screen.getByText(/Referred to a physician on/);
    expect(line).toBeVisible();
    expect(line.textContent).toMatch(/Aug\s1; re-signed with no physician clearance on file/);
    const link = within(line.closest("li") as HTMLElement).getByRole("link", {
      name: "View the referral",
    });
    expect(link).toHaveAttribute("href", "/shop/blue-mantis/divers/p-r/waivers/w-referred");
  });

  it("says nothing on a held seat: the referral is the matched person's history", () => {
    const held = entry("r", "Noor Haddad", { identityBookedAs: "Noor H." });
    (held.booking as { identityUnconfirmedAt: Date | null }).identityUnconfirmedAt = new Date(
      "2026-08-20T15:00:00Z",
    );
    renderRoster({
      ...fixtures,
      roster: [held],
      readiness: new Map([["r", referredRow("blocked")]]) as ReadinessByBooking,
      waivers: new Map([["r", signedWaiver]]) as WaiverByBooking,
    });
    expect(screen.queryByText(/Referred to a physician on/)).toBeNull();
  });
});
