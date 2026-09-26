// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { waiverSendCopy } from "@/app/actions/waiver-send-types";
import { staffTranslator } from "@/i18n/staff-messages";

// The waiver send composes the `"use server"` held-send actions; the layout is
// what is under test here, so they are references and nothing more.
vi.mock("@/app/actions/held-sends", () => ({
  holdSendAction: vi.fn(),
  undoHeldSendAction: vi.fn(),
  releaseHeldSendAction: vi.fn(),
}));

const { BlockedDiverRow } = await import("./BlockedDiverRow");

afterEach(cleanup);

const t = staffTranslator("en-US");

function renderBeside(sendsWaiver: boolean) {
  return render(
    <BlockedDiverRow
      layout="beside"
      identity={<p>Declan Murphy</p>}
      blockers={[]}
      fix={{ label: "Fix it", href: "/shop/blue-mantis/divers/p-1", sendsWaiver, bookingId: "b-1" }}
      surface="today"
      waiverCopy={waiverSendCopy(t)}
      t={t}
    />,
  );
}

/**
 * **One size for a row's fix, whichever fix it is.** Beside the diver, in the
 * dense row list, the fix is a row's control and takes `sm` (`button.ts`: "a
 * ledger row, a table cell or a chip row takes `sm`"). Both of its shapes were
 * the default `md`, a 48px button with a 16px label in a row whose siblings
 * draw 44px and 14px.
 */
describe("BlockedDiverRow beside the diver", () => {
  it("draws a link fix at the row's size", () => {
    renderBeside(false);
    const link = screen.getByRole("link", { name: "Fix it" });
    expect(link).toHaveClass("text-sm", "py-2");
    expect(link).not.toHaveClass("min-h-12");
  });

  it("draws a waiver send at the same size", () => {
    renderBeside(true);
    const button = screen.getByRole("button", { name: "Fix it" });
    expect(button).toHaveClass("text-sm", "py-2");
    expect(button).not.toHaveClass("min-h-12");
  });
});
