// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { diverTranslator } from "@/i18n/messages";
import { ReadyDateActions } from "./ReadyDateActions";

const t = diverTranslator("en-US");
afterEach(cleanup);
const seat = (
  bookingId: string,
  claimed = false,
  differentDeparture = false,
  hasInvitation = false,
  seatHeld = true,
) => ({ bookingId, claimed, differentDeparture, hasInvitation, seatHeld });
describe("ready date next actions", () => {
  it("offers the existing request section only from its actual open or pending state", () => {
    const { rerender } = render(<ReadyDateActions moveAsk={null} seats={[]} t={t} />);
    expect(screen.queryByRole("link")).toBeNull();
    rerender(<ReadyDateActions moveAsk="open" seats={[]} t={t} />);
    expect(screen.getByRole("link", { name: t("ready.moveAsk.changePlans") })).toHaveAttribute(
      "href",
      "#move-ask",
    );
    rerender(
      <ReadyDateActions
        moveAsk={{ note: "", sentAt: new Date("2026-10-26T12:00:00Z") }}
        seats={[]}
        t={t}
      />,
    );
    expect(screen.getByRole("link", { name: t("ready.moveAsk.requestPending") })).toHaveAttribute(
      "href",
      "#move-ask",
    );
    expect(screen.queryByRole("button")).toBeNull();
  });
  it("counts the lead only for actual companions, and counts unclaimed even without a minted link", () => {
    render(
      <ReadyDateActions
        moveAsk={null}
        seats={[seat("one", false, false, true), seat("two"), seat("three", true)]}
        t={t}
      />,
    );
    expect(
      screen.getByRole("link", { name: t("ready.groupSummary", { total: 4, unclaimed: 2 }) }),
    ).toHaveAttribute("href", "#party-seat-one");
    expect(document.body.textContent).not.toContain("private");
  });
  it("targets the group when no invitation is available and names moved departures honestly", () => {
    const { rerender } = render(
      <ReadyDateActions moveAsk={null} seats={[seat("one", false, true)]} t={t} />,
    );
    expect(screen.getByRole("link")).toHaveAttribute("href", "#party-seats");
    expect(screen.getByText(t("ready.groupDifferentDeparture"))).toBeVisible();
    rerender(<ReadyDateActions moveAsk={null} seats={[seat("one", true)]} t={t} />);
    expect(
      screen.getByRole("link", { name: t("ready.groupSummary", { total: 2, unclaimed: 0 }) }),
    ).toHaveAttribute("href", "#party-seats");
  });
});

describe("only held companion seats enter the current group summary", () => {
  it("excludes a released unclaimed companion while retaining an active claimed companion", () => {
    const seats = [seat("released", false, false, true, false), seat("active", true)];
    render(<ReadyDateActions moveAsk={null} seats={seats} t={t} />);
    expect(
      screen.getByRole("link", { name: t("ready.groupSummary", { total: 2, unclaimed: 0 }) }),
    ).toHaveAttribute("href", "#party-seats");
    // The historical panel input is preserved; this component only reads it.
    expect(seats).toHaveLength(2);
    expect(seats[0].bookingId).toBe("released");
  });
  it("hides the group summary when all companions have been released, retaining an independent move door", () => {
    const seats = [seat("one", false, false, false, false), seat("two", true, false, false, false)];
    const { rerender, container } = render(<ReadyDateActions moveAsk={null} seats={seats} t={t} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<ReadyDateActions moveAsk="open" seats={seats} t={t} />);
    expect(screen.getByRole("link", { name: t("ready.moveAsk.changePlans") })).toHaveAttribute(
      "href",
      "#move-ask",
    );
    expect(screen.getAllByRole("link")).toHaveLength(1);
  });
  it("a moved released seat creates neither a count nor a different-departure note", () => {
    const { container } = render(
      <ReadyDateActions
        moveAsk={null}
        seats={[seat("moved-released", false, true, false, false)]}
        t={t}
      />,
    );
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByText(t("ready.groupDifferentDeparture"))).toBeNull();
  });
  it("chooses the first held invitation and counts only held moved seats in mixed input", () => {
    const released = seat("released", false, true, true, false);
    const held = seat("active", false, false, true);
    const movedHeld = seat("moved-active", true, true);
    const { rerender } = render(
      <ReadyDateActions moveAsk={null} seats={[released, held, movedHeld]} t={t} />,
    );
    expect(
      screen.getByRole("link", { name: t("ready.groupSummary", { total: 3, unclaimed: 1 }) }),
    ).toHaveAttribute("href", "#party-seat-active");
    expect(screen.getByText(t("ready.groupDifferentDeparture"))).toBeVisible();
    rerender(<ReadyDateActions moveAsk={null} seats={[released, held]} t={t} />);
    expect(
      screen.getByRole("link", { name: t("ready.groupSummary", { total: 2, unclaimed: 1 }) }),
    ).toHaveAttribute("href", "#party-seat-active");
    expect(screen.queryByText(t("ready.groupDifferentDeparture"))).toBeNull();
  });
});
