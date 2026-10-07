// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { DiverMergeCandidate } from "@/db/diver-merge";
import { staffTranslator } from "@/i18n/staff-messages";
import { MergeDiver } from "./MergeDiver";

afterEach(cleanup);

const candidates = [
  {
    id: "11111111-1111-4111-8111-111111111111",
    fullName: "Maya Rivera",
    email: "maya@example.test",
    phone: "+13055550142",
    reasons: ["same_email" as const, "same_name_and_birth_date" as const],
  },
  {
    id: "22222222-2222-4222-8222-222222222222",
    fullName: "Maya Rivera",
    email: null,
    phone: "+13055550142",
    reasons: ["same_phone" as const],
  },
];
const personId = "33333333-3333-4333-8333-333333333333";

function renderPanel(list: DiverMergeCandidate[] = candidates) {
  return render(
    <MergeDiver
      candidates={list}
      shopSlug="blue-mantis"
      personId={personId}
      t={staffTranslator("en-US")}
    />,
  );
}

/**
 * Nothing merges from the record any more. Each likely duplicate is a door to
 * the side-by-side preview, where the staffer chooses which record to keep and
 * which value wins; a panel that merged on one tap from here had no room to
 * show what moves.
 */
describe("the possible duplicates panel", () => {
  it("opens the preview for each duplicate, never for the record itself", () => {
    renderPanel();
    const links = screen.getAllByRole("link", { name: /Compare with/ });
    expect(links.map((link) => link.getAttribute("href"))).toEqual(
      candidates.map((c) => `/shop/blue-mantis/divers/${personId}/merge/${c.id}`),
    );
    expect(screen.queryAllByRole("radio")).toHaveLength(0);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("lists the strongest five and counts the rest", () => {
    const many = Array.from({ length: 8 }, (_, index) => ({
      ...candidates[1],
      id: `4444444${index}-4444-4444-8444-444444444444`,
      fullName: `Diver ${index}`,
    })) as DiverMergeCandidate[];
    renderPanel(many);
    expect(screen.getAllByRole("link", { name: /Compare with/ })).toHaveLength(5);
    expect(screen.getByText("And 3 more")).toBeVisible();
  });

  it("lets a long address wrap rather than widen the page", () => {
    renderPanel([
      { ...candidates[0], email: "a.very.long.address.for.a.dive.club.booking@example.test" },
    ]);
    const line = screen.getByText(/a\.very\.long\.address/).parentElement;
    expect(line?.className).toContain("[overflow-wrap:anywhere]");
    expect(line?.className).toContain("min-w-0");
    expect(screen.queryByText(/more$/)).toBeNull();
  });

  it("says why each record was offered", () => {
    renderPanel();
    expect(screen.getByText("Same email · Same name and date of birth")).toBeVisible();
    expect(screen.getByText("Same phone number")).toBeVisible();
  });

  /**
   * `people.phone` holds E.164 since #1547, and this list is where an owner
   * decides two records are the same person by reading their numbers off the
   * screen. Ungrouped, that decision is taken between two unbroken runs of
   * eleven digits (#1712).
   */
  it("groups a candidate's stored number for the eye comparing them", () => {
    renderPanel();
    expect(screen.getByText("maya@example.test · +1 305 555 0142")).toBeVisible();
    expect(screen.getByText("+1 305 555 0142")).toBeVisible();
    expect(screen.queryByText(/\+13055550142/)).toBeNull();
  });

  it("renders nothing to compare when the roster found no duplicates", () => {
    renderPanel([]);
    expect(screen.queryAllByRole("link")).toHaveLength(0);
  });
});
