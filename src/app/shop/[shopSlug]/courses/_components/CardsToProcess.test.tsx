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

function card(id: string, fullName: string, issuedAt: Date): CardToProcess {
  return {
    kind: "level",
    what: { kind: "level", level: "open_water" },
    certificationId: id,
    agency: "padi",
    issuedAt,
    processedAt: null,
    personId: `p-${id}`,
    fullName,
    courseId: null,
  };
}

describe("CardsToProcess", () => {
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
});
