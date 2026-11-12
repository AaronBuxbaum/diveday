// @vitest-environment jsdom

import { cleanup, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

// The spine composes WaiverSendControl/ResendConfirmationControl/
// PaymentActionControl, each of which statically imports its own `"use server"`
// action file. Those import `requireStaffSession` -> better-auth, which fails
// to resolve under vitest's module graph — mocking them here is what makes the
// spine renderable in this environment at all.
vi.mock("@/app/actions/invoices", () => ({ resendInvoiceAction: vi.fn() }));
vi.mock("@/app/actions/notifications", () => ({ resendConfirmationAction: vi.fn() }));
vi.mock("@/app/actions/held-sends", () => ({
  holdSendAction: vi.fn(),
  undoHeldSendAction: vi.fn(),
  releaseHeldSendAction: vi.fn(),
}));
// The rental-fit row binds its keep action, which lives in the home's sibling
// `actions.ts` — a `"use server"` module whose imports reach better-auth and
// the database. Same reason as the three above.
vi.mock("@/app/shop/[shopSlug]/actions", () => ({
  keepRentalFitAction: vi.fn(),
  acknowledgeCrewAwayAction: vi.fn(),
  helpRequestAction: vi.fn(),
}));
// The agency check's host (H-20261008-cert-check-extension) wraps the spine and repaints through the
// router when a "Check all" ends; no app router is mounted here.
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  useRouter: () => ({ refresh: vi.fn() }),
}));

import type { TodayAction } from "@/features/today/today";
import { pushRollCallRows } from "@/features/today/today-roll-call-rows";
import { rowsContext } from "@/features/today/today-rows-test-fixtures";
import { staffTranslator } from "@/i18n/staff-messages";
import { renderSpine } from "./day-spine-test-fixtures";

afterEach(cleanup);

it.each(["en-US", "es-ES"] as const)("distinguishes grouped meeting-day counts in %s", (locale) => {
  const actions: TodayAction[] = [];
  const gaps = [1, 2].flatMap((dayNumber) =>
    (["after_dive_uncounted", "crew_uncounted"] as const).map((reason) => ({
      tripId: "rescue",
      title: "Rescue Diver",
      capacity: 4,
      priceCents: null,
      dayNumber,
      startsAt: new Date(`2026-07-${10 + dayNumber}T12:00:00Z`),
      endsAt: new Date(`2026-07-${10 + dayNumber}T20:00:00Z`),
      reason,
      diveNumber: 1,
      uncounted: reason === "crew_uncounted" ? 1 : 2,
      total: reason === "crew_uncounted" ? 1 : 2,
      rosterSize: 2,
      underway: false,
      stale: true,
      alertedAt: null,
      shoreAlertedAt: null,
    })),
  );
  pushRollCallRows(
    actions,
    rowsContext(
      {
        boatsOut: { out: [], blocked: [] },
        rollCallGaps: gaps,
        crewClashState: {
          departures: [],
          clashes: new Map(),
          boatClashes: new Map(),
          crew: new Map(),
          divers: new Map(),
        },
      },
      { locale, t: staffTranslator(locale) },
    ),
  );
  expect(new Set(actions.map(({ id }) => id)).size).toBe(4);
  renderSpine({ actions });
  for (const day of [1, 2]) {
    const prefix = locale === "en-US" ? `Day ${day}` : `Día ${day}`;
    expect(
      screen.getAllByText(new RegExp(`${prefix}.*${locale === "en-US" ? "EDT" : "GMT-4"}`)),
    ).toHaveLength(2);
  }
  expect(new Set(actions.map(({ detail }) => detail)).size).toBe(4);
});
