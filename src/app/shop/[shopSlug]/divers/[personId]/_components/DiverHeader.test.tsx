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
  status,
  book = <span>Book a departure</span>,
}: {
  status?: HeaderStatus;
  book?: ComponentProps<typeof DiverHeader>["book"];
} = {}) {
  return render(
    <DiverHeader
      diver={diver()}
      shopSlug="blue-mantis"
      t={t}
      visits={0}
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
 * sat beside Book a departure as a second dropdown; it is the record's first
 * file group now (`DiverDetailsGroup`), so the header's only disclosure is
 * Book's own picker.
 */
describe("DiverHeader actions", () => {
  it("carries Book a departure and nothing beside it", () => {
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
});
