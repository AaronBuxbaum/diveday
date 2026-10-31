// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { CARD_PROCESSING_SINCE, type CardToProcess } from "@/db/agency-processing";
import { staffTranslator } from "@/i18n/staff-messages";
import { DAY_MS } from "@/lib/clock";
import { CardsToProcess } from "./CardsToProcess";

afterEach(cleanup);

/**
 * The first day of "Cards to process" (dive-domain second pass, X2): every
 * card issued before the processed stamp existed has no stamp, so without a
 * cut they would all land on the list as "Waiting over 30 days" and bury the
 * one real late card. They stay listed, in one collapsed line, never late.
 */
const t = staffTranslator("en-US");
const since = CARD_PROCESSING_SINCE.getTime();
const now = new Date(since + 60 * DAY_MS);

function card(
  id: string,
  fullName: string,
  issuedAt: Date,
  agency: CardToProcess["agency"] = "padi",
): CardToProcess {
  return {
    kind: "level",
    what: { kind: "level", level: "open_water" },
    certificationId: id,
    agency,
    issuedAt,
    processedAt: null,
    personId: `p-${id}`,
    fullName,
    courseId: null,
  };
}

describe("CardsToProcess", () => {
  it("groups interleaved agencies in first-seen order and preserves each card order", () => {
    const padiFirst = card("padi-1", "Ana PADI", new Date(since + 55 * DAY_MS));
    const ssi = card("ssi-1", "Ben SSI", new Date(since + 56 * DAY_MS), "ssi");
    const padiSecond = card("padi-2", "Cora PADI", new Date(since + 57 * DAY_MS));
    render(
      <CardsToProcess
        cards={[padiFirst, ssi, padiSecond]}
        markProcessed={() => {}}
        now={now}
        locale="en-US"
        timeZone="UTC"
        t={t}
      />,
    );

    const padiLine = screen.getByText("2 cards to process with PADI");
    const ssiLine = screen.getByText("1 card to process with SSI");
    expect(
      padiLine.compareDocumentPosition(ssiLine) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    const padiNames = within(padiLine.parentElement as HTMLElement)
      .getAllByRole("listitem")
      .map((item) => item.querySelector(".font-medium")?.textContent);
    expect(padiNames).toEqual(["Ana PADI", "Cora PADI"]);
    expect(within(ssiLine.parentElement as HTMLElement).getByText("Ben SSI")).toBeTruthy();
  });

  it("keeps cards from before the stamp in one collapsed line, none of them late", () => {
    const cards = [
      card("old-1", "Ana Old", new Date(since - 400 * DAY_MS)),
      card("old-2", "Ben Old", new Date(since - 2 * DAY_MS)),
      card("late", "Cora Late", new Date(since + 10 * DAY_MS)),
      card("fresh", "Dev Fresh", new Date(since + 55 * DAY_MS)),
    ];
    render(
      <CardsToProcess
        cards={cards}
        markProcessed={() => {}}
        now={now}
        locale="en-US"
        timeZone="UTC"
        t={t}
      />,
    );
    const earlier = document.getElementById("cards-to-process-earlier");
    if (!earlier) throw new Error("Earlier cards disclosure is missing");
    expect(earlier.tagName).toBe("DETAILS");
    expect(earlier.hasAttribute("open")).toBe(false);
    expect(within(earlier).getByText(/2 cards certified before/)).toBeTruthy();
    expect(within(earlier).getByText("Ana Old")).toBeTruthy();
    expect(within(earlier).getByText("Ben Old")).toBeTruthy();
    expect(earlier.querySelectorAll("[data-late]")).toHaveLength(0);

    // The real late card stands out on its own, above the collapsed line.
    const late = screen.getAllByText(t("courses.processing.late"));
    expect(late).toHaveLength(1);
    expect(within(earlier).queryByText("Cora Late")).toBeNull();
    expect(screen.getByText("2 cards to process with PADI")).toBeTruthy();
  });

  it("has no earlier line when every card is after the stamp", () => {
    render(
      <CardsToProcess
        cards={[card("fresh", "Dev Fresh", new Date(since + DAY_MS))]}
        markProcessed={() => {}}
        now={now}
        locale="en-US"
        timeZone="UTC"
        t={t}
      />,
    );
    expect(screen.queryByTestId("cards-to-process-earlier")).toBeNull();
  });

  /**
   * **A clock from before the stamp existed names no date ahead of it**
   * (visual triage of PR #2918, item 1d). Under the frozen Jul 21 clock the
   * cut was the fixed Oct 16 migration instant, so every card read
   * "certified before Fri, Oct 16", a day the clock had not reached. A world
   * whose clock predates the migration already has the stamp, so every card
   * has a known wait and none is set apart.
   */
  it("sets nothing apart under a clock from before the stamp existed", () => {
    const before = new Date(since - 90 * DAY_MS);
    render(
      <CardsToProcess
        cards={[
          card("recent", "Eve Recent", new Date(before.getTime() - 9 * DAY_MS)),
          card("waiting", "Fay Waiting", new Date(before.getTime() - 31 * DAY_MS)),
        ]}
        markProcessed={() => {}}
        now={before}
        locale="en-US"
        timeZone="UTC"
        t={t}
      />,
    );
    expect(document.getElementById("cards-to-process-earlier")).toBeNull();
    expect(screen.queryByText(/certified before/)).toBeNull();
    expect(screen.getByText("Eve Recent")).toBeTruthy();
    expect(screen.getAllByText(t("courses.processing.late"))).toHaveLength(1);
  });
});
