// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { staffTranslator } from "@/i18n/staff-messages";
import type { DiverStatusRow } from "../_lib/status";
import { DiverStatusLedger } from "./DiverStatusLedger";

afterEach(cleanup);

const t = staffTranslator("en-US");

function renderLedger(rows: DiverStatusRow[]) {
  return render(
    <DiverStatusLedger
      rows={rows}
      t={t}
      locale="en-US"
      timezone="America/Cancun"
      shopSlug="blue-mantis"
    />,
  );
}

/**
 * **The record's pinned silence** (ADR 20260827-people-not-lists). A diver
 * with nothing outstanding gets no status section at all — the surface is
 * asserted empty, not merely "without rows", because a heading over nothing or
 * an "all clear" line would each spend the reader's first glance on an absence.
 */
describe("a clear diver", () => {
  it("renders nothing at all", () => {
    const { container } = renderLedger([]);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("an open item", () => {
  it("leads with its kind, states the sentence, and offers one fix", () => {
    renderLedger([
      {
        kind: "certification",
        tone: "warning",
        sentence: { key: "divers.status.cardsWaiting", values: { count: 1 } },
        action: { labelKey: "divers.status.acts.verify", target: "verify" },
      },
    ]);
    expect(screen.getByText("Certification")).toBeInTheDocument();
    expect(
      screen.getByText("A certification record is waiting for verification."),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Verify it" })).toHaveAttribute(
      "href",
      "#card-awaiting",
    );
  });

  /**
   * Colour never carries a state on its own (principles.md #6): the tone is in
   * the kind word's ink, and the kind word is a word.
   */
  it("never carries its tone in colour alone", () => {
    renderLedger([
      {
        kind: "waiver",
        tone: "danger",
        sentence: { blocker: { code: "waiver_not_sent" } },
        action: { labelKey: "divers.status.acts.sendWaiver", target: "send_waiver" },
      },
    ]);
    const word = screen.getByText("Waiver");
    expect(word.className).toContain("text-danger");
    expect(word.textContent).toBe("Waiver");
  });

  it("words a readiness blocker through the shared table, not a sentence of its own", () => {
    renderLedger([
      {
        kind: "certification",
        tone: "danger",
        sentence: { blocker: { code: "certification_pending" } },
        action: { labelKey: "divers.status.acts.verify", target: "verify" },
      },
    ]);
    expect(
      screen.getByText(t("shared.readiness.blockers.certificationPending")),
    ).toBeInTheDocument();
  });

  it("sends Collect to the invoice that owes, and to the story when nothing was raised", () => {
    const row: DiverStatusRow = {
      kind: "payment",
      tone: "warning",
      sentence: { key: "divers.status.openBalance", values: { count: 1 } },
      action: { labelKey: "divers.status.acts.collect", target: "collect" },
      orderId: "order-9",
    };
    renderLedger([row]);
    expect(screen.getByRole("link", { name: "Collect" })).toHaveAttribute(
      "href",
      "/shop/blue-mantis/orders/order-9",
    );
    cleanup();
    renderLedger([{ ...row, orderId: undefined }]);
    expect(screen.getByRole("link", { name: "Collect" })).toHaveAttribute("href", "#the-story");
  });

  /** A row the shop cannot act on renders no fix rather than an invented one. */
  it("renders no link for a row with no fix", () => {
    renderLedger([
      { kind: "waiver", tone: "danger", sentence: { key: "divers.status.waiverHeld" } },
    ]);
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText("A medical answer is with a doctor for sign-off.")).toBeInTheDocument();
  });

  it("names the departure a blocker is bound to, in the shop's own zone", () => {
    renderLedger([
      {
        kind: "waiver",
        tone: "danger",
        sentence: { blocker: { code: "waiver_not_sent" } },
        action: { labelKey: "divers.status.acts.sendWaiver", target: "send_waiver" },
        tripContext: { tripId: "trip-1", startsAt: new Date("2026-08-27T11:00:00.000Z") },
      },
    ]);
    // 11:00 UTC is 6:00 in America/Cancun — the shop's zone, never the host's.
    expect(screen.getByText("On Thu, Aug 27 · 6:00 AM.")).toBeInTheDocument();
  });
});
