// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { staffTranslator } from "@/i18n/staff-messages";
import { BookActivity } from "./BookActivity";
import { DiverHeader } from "./DiverHeader";
import type { DiverProfile, Shop, UpcomingTrip } from "./shared";

vi.mock("../details-actions", () => ({ savePersonAction: vi.fn() }));
vi.mock("@/app/actions/seat-diver", () => ({ seatExistingDiverAction: vi.fn() }));

afterEach(cleanup);

const t = staffTranslator("en-US");
const NO_STANDING = { diveDays: 0, since: null, lastOut: null, spent: null, friends: 0 };
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
  status,
  book = <span>Add a booking</span>,
}: {
  status?: HeaderStatus;
  book?: ComponentProps<typeof DiverHeader>["book"];
} = {}) {
  return render(
    <DiverHeader
      diver={diver()}
      shopSlug="blue-mantis"
      t={t}
      standing={NO_STANDING}
      locale="en-US"
      book={book}
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

/**
 * **One act in the masthead** (ADR 20261001-logbook, decision 2). Edit details
 * sat beside Add a booking as a second dropdown; it is the record's first
 * file group now (`DiverDetailsGroup`), so the header's only disclosure is
 * Book's own picker.
 */
describe("DiverHeader actions", () => {
  it("leaves only the identity header when no booking action is available", () => {
    const { container } = renderHeader({ book: null });
    expect(container.childElementCount).toBe(1);
  });

  it("carries Add a booking and nothing beside it", () => {
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
    expect(summaries.map((summary) => summary.id)).toEqual(["book-departure"]);
    expect(container.querySelector("#edit-details")).toBeNull();
  });

  it("shows a saved-details confirmation under the masthead", () => {
    const status: HeaderStatus = { form: "details", tone: "success", text: "Details saved." };
    const { getByText } = renderHeader({ status });
    expect(getByText("Details saved.")).toBeInTheDocument();
  });

  it("stands the departure picker level with the button it sits beside", () => {
    const { container } = render(
      <BookActivity
        diver={diver()}
        shop={{ timezone: "America/New_York" } as Shop}
        locale="en-US"
        t={t}
        upcoming={[
          {
            id: "trip-1",
            title: "Reef departure",
            startsAt: new Date("2031-01-01T15:00:00Z"),
            course: null,
          } as UpcomingTrip,
        ]}
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
});

/** "Package: 7 of 10 dives left" (fourth UX review, item 20). */
describe("the package line", () => {
  it("says how many of the package's dives are left", () => {
    const { getByText } = render(
      <DiverHeader
        diver={diver()}
        shopSlug="blue-mantis"
        t={t}
        standing={NO_STANDING}
        locale="en-US"
        packages={{ left: 7, of: 10 }}
      />,
    );
    expect(getByText("Package: 7 of 10 dives left")).toBeInTheDocument();
  });

  it("says nothing for a diver with no package", () => {
    const { container } = renderHeader();
    expect(container.textContent).not.toContain("Package:");
  });
});

/**
 * **Who this person is to the shop, in one line** (fifth-loop ideas, item 36).
 * Each fact stands alone and says nothing when there is nothing to say.
 */
describe("the standing line", () => {
  it("says dive days since when, last out, money kept and friends brought", () => {
    const { container } = render(
      <DiverHeader
        diver={diver()}
        shopSlug="blue-mantis"
        t={t}
        locale="en-US"
        standing={{
          diveDays: 23,
          since: "2024-03-02",
          lastOut: "2026-09-30",
          spent: { cents: 214_000, currency: "usd" },
          friends: 2,
        }}
      />,
    );
    const text = container.textContent ?? "";
    expect(text).toContain("23 dive days since Mar 2024");
    expect(text).toMatch(/Last out Sep\s30, 2026/);
    expect(text).toContain("$2,140.00 spent");
    expect(text).toContain("Brought 2 friends");
  });

  it("says none of it for someone new, or money to a reader who may not see it", () => {
    const { container } = renderHeader();
    expect(container.textContent).not.toMatch(/visit|Last out|spent|Brought/);
  });
});
