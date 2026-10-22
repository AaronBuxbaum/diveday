// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

function manyCandidates(count = 8): DiverMergeCandidate[] {
  return Array.from({ length: count }, (_, index) => ({
    ...candidates[1],
    id: `44444444-4444-4444-8444-${String(index).padStart(12, "0")}`,
    fullName: `Diver ${index + 1}`,
  }));
}

function renderPanel(list: DiverMergeCandidate[] = candidates, locale = "en-US") {
  return render(
    <MergeDiver
      candidates={list}
      shopSlug="blue-mantis"
      personId={personId}
      t={staffTranslator(locale)}
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

  it("lists only the strongest five until staff ask for more", () => {
    const many = manyCandidates();
    renderPanel(many);
    expect(
      screen
        .getAllByRole("link", { name: /Compare with/ })
        .map((link) => link.getAttribute("href")),
    ).toEqual(
      many
        .slice(0, 5)
        .map((candidate) => `/shop/blue-mantis/divers/${personId}/merge/${candidate.id}`),
    );
    expect(screen.queryByRole("link", { name: "Compare with Diver 6" })).toBeNull();
    expect(screen.queryByText("Diver 6")).toBeNull();
    expect(screen.getByRole("button", { name: "Show more" })).toBeVisible();
  });

  it("reveals candidate six by pointer with its reason and comparison link", async () => {
    const user = userEvent.setup();
    const many = manyCandidates();
    renderPanel(many);

    await user.click(screen.getByRole("button", { name: "Show more" }));

    const links = screen.getAllByRole("link", { name: /Compare with/ });
    expect(links.map((link) => link.getAttribute("href"))).toEqual(
      many.map((candidate) => `/shop/blue-mantis/divers/${personId}/merge/${candidate.id}`),
    );
    expect(screen.getAllByText("Same phone number")).toHaveLength(8);
    expect(screen.getByRole("link", { name: "Compare with Diver 6" })).toHaveFocus();
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByRole("radio")).toBeNull();
    expect(screen.queryByRole("checkbox")).toBeNull();
  });

  for (const key of ["{Enter}", " "]) {
    it(`reaches candidate six from the keyboard with ${key}`, async () => {
      const user = userEvent.setup();
      renderPanel(manyCandidates());
      for (let index = 0; index < 6; index += 1) await user.tab();
      expect(screen.getByRole("button", { name: "Show more" })).toHaveFocus();

      await user.keyboard(key);

      expect(screen.getByRole("link", { name: "Compare with Diver 6" })).toHaveFocus();
      expect(screen.getAllByRole("link", { name: /Compare with/ })).toHaveLength(8);
    });
  }

  it("reveals at most five more candidates per action, in their ranked order", async () => {
    const user = userEvent.setup();
    const many = manyCandidates(13);
    renderPanel(many);

    await user.click(screen.getByRole("button", { name: "Show more" }));
    expect(screen.getAllByRole("link", { name: /Compare with/ })).toHaveLength(10);
    expect(screen.queryByRole("link", { name: "Compare with Diver 11" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Show more" }));

    expect(
      screen
        .getAllByRole("link", { name: /Compare with/ })
        .map((link) => link.getAttribute("href")),
    ).toEqual(
      many.map((candidate) => `/shop/blue-mantis/divers/${personId}/merge/${candidate.id}`),
    );
    expect(screen.getByRole("link", { name: "Compare with Diver 11" })).toHaveFocus();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("offers the continuation in Spanish too", async () => {
    const user = userEvent.setup();
    const t = staffTranslator("es-ES");
    renderPanel(manyCandidates(), "es-ES");

    await user.click(screen.getByRole("button", { name: t("divers.merge.showMore") }));

    expect(
      screen.getByRole("link", { name: t("divers.merge.compareWith", { name: "Diver 6" }) }),
    ).toHaveFocus();
  });

  it("offers no continuation when exactly five candidates exist", () => {
    renderPanel(manyCandidates(5));
    expect(screen.getAllByRole("link", { name: /Compare with/ })).toHaveLength(5);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("leaves focus alone when the same candidate set rerenders", async () => {
    const user = userEvent.setup();
    const many = manyCandidates();
    const { rerender } = renderPanel(many);
    await user.click(screen.getByRole("button", { name: "Show more" }));
    const first = screen.getByRole("link", { name: "Compare with Diver 1" });
    first.focus();

    rerender(
      <MergeDiver
        candidates={[...many]}
        shopSlug="blue-mantis"
        personId={personId}
        t={staffTranslator("en-US")}
      />,
    );

    expect(first).toHaveFocus();
    expect(screen.getAllByRole("link", { name: /Compare with/ })).toHaveLength(8);
  });

  it("starts from five again when staff open a different diver record", async () => {
    const user = userEvent.setup();
    const many = manyCandidates();
    const { rerender } = renderPanel(many);
    await user.click(screen.getByRole("button", { name: "Show more" }));
    expect(screen.getAllByRole("link", { name: /Compare with/ })).toHaveLength(8);

    rerender(
      <MergeDiver
        candidates={many}
        shopSlug="blue-mantis"
        personId="55555555-5555-4555-8555-555555555555"
        t={staffTranslator("en-US")}
      />,
    );

    expect(screen.getAllByRole("link", { name: /Compare with/ })).toHaveLength(5);
    expect(screen.getByRole("button", { name: "Show more" })).toBeVisible();
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
