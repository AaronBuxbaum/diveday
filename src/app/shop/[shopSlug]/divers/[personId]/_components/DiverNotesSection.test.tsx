// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { tapTargetLinkClass } from "@/components/ui/button";
import { staffTranslator } from "@/i18n/staff-messages";
import { DiverNotesSection } from "./DiverNotesSection";

// The add and delete forms reach server actions, and with them the whole Next
// server runtime. This suite is about how a note's lines are drawn.
vi.mock("../note-actions", () => ({ addDiverNoteAction: vi.fn(), deleteDiverNoteAction: vi.fn() }));

afterEach(cleanup);

type Note = ComponentProps<typeof DiverNotesSection>["notes"][number];

function tripNote(): Note {
  return {
    note: {
      id: "note-1",
      shopId: "shop-1",
      personId: "person-1",
      bookingId: "booking-1",
      body: "Prefers the bow on the way out.",
      createdByPersonId: "person-9",
      createdAt: new Date("2026-07-20T14:00:00.000Z"),
    },
    authorName: "Marisol Vega",
    tripId: "trip-1",
    tripTitle: "Two-Tank Reef — Molasses & French",
    tripStartsAt: new Date("2026-07-21T18:30:00.000Z"),
  } as unknown as Note;
}

describe("a note that came with a booking", () => {
  /**
   * **The departure it came from is a 44px target** (pixel-craft class 7). The
   * "From <trip> · <date>" link under the note was a line of 14px text, 20px
   * tall on one line and 40px on two at 390, under the floor a thumb needs.
   * It takes the shared link floor, which also gives it the room its `mt-1`
   * used to stand in for.
   */
  it("links to its departure through a full tap target", () => {
    render(
      <DiverNotesSection
        notes={[tripNote()]}
        shopSlug="blue-mantis"
        personId="person-1"
        locale="en-US"
        timezone="America/New_York"
        t={staffTranslator("en-US")}
      />,
    );

    const link = screen.getByRole("link", { name: /Two-Tank Reef/ });
    expect(link).toHaveAttribute("href", "/shop/blue-mantis/trips/trip-1");
    expect(link).toHaveClass(...tapTargetLinkClass.split(" "));
    expect(link).not.toHaveClass("inline-block");
    expect(link).not.toHaveClass("mt-1");
  });
});
