// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { staffTranslator } from "@/i18n/staff-messages";
import { PACKET_PAPER } from "@/lib/print-sheets";
import type { DisputeSheet } from "../../../../../../../../features/dispute-sheet/rules";
import { ShopSheet } from "../../../../../print/_components/ShopSheet";
import { DisputeSheetPaper } from "./DisputeSheetPaper";

afterEach(cleanup);

const t = staffTranslator("en-US");

/** Anything a person could press, type in or follow. A sheet holds none. */
const CONTROLS = "a, button, input, select, textarea, form, [role='button'], [tabindex]";

const at = (hour: number) => new Date(Date.UTC(2026, 9, 12, hour));

const SHEET: DisputeSheet = {
  shopName: "Blue Mantis Divers",
  timezone: "America/New_York",
  generatedAt: at(20),
  diverName: "Grace Halloran",
  trip: { title: "Wreck Trip", startsAt: at(12) },
  order: {
    description: "Wreck Trip seat",
    status: "paid",
    currency: "usd",
    totalCents: 12_000,
    taxCents: 0,
    amountPaidCents: 12_000,
    refundedCents: 0,
    createdAt: at(1),
    paidAt: at(2),
    lines: [{ description: "Wreck Trip", kind: "trip", quantity: 1, unitAmountCents: 12_000 }],
  },
  waiver: {
    signedAt: at(3),
    signedName: "Grace Halloran",
    method: "online",
    templateTitle: "Diving Release",
    templateVersion: 3,
  },
  checkIn: { at: at(11), recordedByName: "Sam Crew", offline: false },
  rollCall: [
    {
      checkpoint: "departure",
      result: "boarded",
      at: at(12),
      recordedByName: "Sam Crew",
      offline: false,
    },
  ],
  activity: [],
};

function renderSheet() {
  return render(
    <ShopSheet
      paper={PACKET_PAPER}
      shop={{ name: "Blue Mantis Divers", brandColor: null }}
      shopSlug="blue-mantis"
      name={t("disputeSheet.title")}
      printed="Printed Oct 12, 2026 · 4:00 PM EDT"
    >
      <DisputeSheetPaper sheet={SHEET} t={t} locale="en-US" timezone="America/New_York" />
    </ShopSheet>,
  );
}

/** Issue #2390; issue #2745: the dispute sheet is one sheet of the shop's paper. */
describe("the dispute sheet", () => {
  it("is one sheet of the shop's paper, with no control on it", () => {
    const { container } = renderSheet();
    const sheets = container.querySelectorAll(".paper-sheet");
    expect(sheets).toHaveLength(1);
    expect(sheets[0]?.querySelectorAll(CONTROLS)).toHaveLength(0);
    expect(container.querySelector(".paper-sheet-band")?.textContent).toContain(
      t("disputeSheet.title"),
    );
  });

  it("prints the order, the signed release, the check-in and the roll call", () => {
    renderSheet();
    expect(screen.getByRole("heading", { level: 1, name: "Grace Halloran" })).toBeTruthy();
    for (const heading of [
      "disputeSheet.orderHeading",
      "disputeSheet.waiverHeading",
      "disputeSheet.checkInHeading",
      "disputeSheet.rollCallHeading",
      "disputeSheet.activityHeading",
    ] as const) {
      expect(screen.getByRole("heading", { name: t(heading) })).toBeTruthy();
    }
    expect(screen.getByText(t("disputeSheet.factsOnly"))).toBeTruthy();
    expect(screen.getByText(t("disputeSheet.resultBoarded"))).toBeTruthy();
    expect(screen.getByText(t("disputeSheet.activityNone"))).toBeTruthy();
  });
});
