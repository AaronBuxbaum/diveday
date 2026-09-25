// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { staffTranslator } from "@/i18n/staff-messages";
import { BookActivity } from "./BookActivity";
import { DiverHeader } from "./DiverHeader";
import type { DiverProfile, Shop } from "./shared";

vi.mock("../actions", () => ({ savePersonAction: vi.fn() }));
vi.mock("@/app/actions/seat-diver", () => ({ seatExistingDiverAction: vi.fn() }));

afterEach(cleanup);

const t = staffTranslator("en-US");
type HeaderStatus = ComponentProps<typeof DiverHeader>["status"];

function diver(): DiverProfile {
  return {
    person: {
      id: "person-1",
      fullName: "Mira Castellanos",
      email: "mira@example.test",
      phone: "+13055550142",
      diveInsurance: null,
      dateOfBirth: null,
      emergencyContactName: null,
      emergencyContactPhone: null,
      deletedAt: null,
    },
  } as unknown as DiverProfile;
}

function renderHeader({
  editOpen = false,
  status,
  book = <span>Book a departure</span>,
}: {
  editOpen?: boolean;
  status?: HeaderStatus;
  book?: ComponentProps<typeof DiverHeader>["book"];
} = {}) {
  return render(
    <DiverHeader
      diver={diver()}
      shopSlug="blue-mantis"
      personId="person-1"
      t={t}
      locale="en-US"
      country="US"
      visits={0}
      book={book}
      editOpen={editOpen}
      status={status}
    />,
  );
}

/**
 * `people.phone` holds E.164 since #1547 (`storedPhone`, src/db/person-phone.ts),
 * so this line read `+13055550142` — right, and eleven digits in a row for the
 * staffer reading it aloud while the diver stands at the counter. The grouping
 * is display only: the `tel:` the same anchor carries is still the stored value,
 * which is what a tap dials (#1712).
 */
describe("the diver's phone number", () => {
  it("groups the stored number and still dials the stored one", () => {
    const { container } = renderHeader();
    const link = container.querySelector<HTMLAnchorElement>('a[href^="tel:"]');

    expect(link?.textContent).toBe("+1 305 555 0142");
    expect(link?.getAttribute("href")).toBe("tel:+13055550142");
  });
});

describe("DiverHeader edit disclosure", () => {
  it("keeps the summary in the action row while its full-width form is open", () => {
    const { container } = renderHeader({ editOpen: true });
    const details = container.querySelector("details");
    const summary = container.querySelector<HTMLElement>("#edit-details");

    expect(details).not.toBeNull();
    expect(details).toHaveAttribute("open");
    expect(summary?.tagName).toBe("SUMMARY");
    expect(details).toHaveClass("group", "open:contents");
    expect(details).not.toHaveClass("open:w-full");
    expect(summary).toHaveClass("inline-flex", "min-h-11", "items-center");
    expect(details?.querySelector("form")).toHaveClass("w-full");
    expect(details?.parentElement).toHaveClass("flex", "flex-wrap");

    summary?.focus();
    expect(document.activeElement).toBe(summary);
  });

  /**
   * **The masthead's action row is one size, `md`.** "Book a departure"
   * arrives in the `book` slot at the default size and "Edit details" was
   * `sm`: a 48px, 16px primary beside a 44px, 14px secondary, top-aligned, so
   * the pair ended 4px apart on every diver record (the pixel probe's
   * `mismatched-controls` cluster, 72 flags on twelve captures, 2026-09-25).
   * Rendered with the real `BookActivity`, because the drift was two
   * components choosing their sizes apart.
   */
  it("draws Edit details at the size of the Book a departure beside it", () => {
    const book = (
      <BookActivity
        diver={diver()}
        shop={{ timezone: "America/New_York" } as Shop}
        locale="en-US"
        t={t}
        upcoming={[]}
        shopSlug="blue-mantis"
        personId="person-1"
      />
    );
    const { container } = renderHeader({ book });
    const summaries = [...container.querySelectorAll<HTMLElement>("summary")];
    expect(summaries.map((summary) => summary.id)).toEqual(["book-departure", "edit-details"]);
    for (const summary of summaries) {
      expect(summary, summary.id).toHaveClass("min-h-12", "text-base");
      expect(summary, summary.id).not.toHaveClass("text-sm");
    }
  });

  it("stands the departure picker level with the button it sits beside", () => {
    const { container } = render(
      <BookActivity
        diver={diver()}
        shop={{ timezone: "America/New_York" } as Shop}
        locale="en-US"
        t={t}
        upcoming={[]}
        shopSlug="blue-mantis"
        personId="person-1"
      />,
    );
    const picker = container.querySelector("select[name='tripId']");
    const submit = container.querySelector("form button[type='submit']");
    expect(picker).toHaveClass("min-h-12");
    expect(picker).not.toHaveClass("min-h-11");
    expect(submit).toHaveClass("min-h-12", "text-base");
  });

  it("honors an initially open editor and keeps a danger notice with it", () => {
    const status: HeaderStatus = {
      form: "details",
      tone: "danger",
      text: "Could not save the diver details.",
    };
    const { container, getByRole } = renderHeader({ editOpen: true, status });
    const details = container.querySelector("details");

    expect(details).toHaveAttribute("open");
    expect(getByRole("alert")).toHaveTextContent(status.text);
  });
});
