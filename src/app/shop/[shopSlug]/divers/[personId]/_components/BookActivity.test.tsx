// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { staffTranslator } from "@/i18n/staff-messages";
import { BookActivity } from "./BookActivity";
import type { DiverProfile, Shop, UpcomingTrip } from "./shared";

vi.mock("@/app/actions/seat-diver", () => ({ seatExistingDiverAction: vi.fn() }));
afterEach(cleanup);

const personId = "00000000-0000-4000-8000-000000000001";
const diver = { person: { email: "diver@example.test" } } as DiverProfile;
const shop = { timezone: "America/New_York" } as Shop;
const t = staffTranslator("en-US");
const trip = {
  id: "00000000-0000-4000-8000-000000000002",
  startsAt: new Date("2031-01-01T23:00:00Z"),
  title: "Later reef",
  course: null,
} as UpcomingTrip;

function picker(page = 1, upcoming: UpcomingTrip[] = [trip], pageCount = 2) {
  return render(
    <BookActivity
      diver={diver}
      shop={shop}
      locale="en-US"
      t={t}
      upcoming={upcoming}
      shopSlug="blue-mantis"
      personId={personId}
      pagination={{ page, pageCount }}
      query={{
        activity: "3",
        gate: ["signed-gate", "second-gate"],
        edit: "contact",
        notice: "booked",
        undo: "undo-token",
        cardType: "open-water",
        by: "Staff",
        form: "book",
        noteBody: "A removed note",
      }}
    />,
  );
}

describe("the record's booking continuation", () => {
  it("keeps the diver and durable query state without replaying consumed notices or edits", () => {
    const { container } = picker();
    container.querySelector("details")?.setAttribute("open", "");
    const later = screen.getByRole("link", { name: "Later departures" });
    const url = new URL(later.getAttribute("href") ?? "", "https://example.test");
    expect(url.pathname).toBe(`/shop/blue-mantis/divers/${personId}`);
    expect(url.searchParams.get("bookingPage")).toBe("2");
    expect(url.searchParams.get("activity")).toBe("3");
    expect(url.searchParams.getAll("gate")).toEqual(["signed-gate", "second-gate"]);
    for (const key of ["notice", "undo", "cardType", "by", "form", "edit", "noteBody"]) {
      expect(url.searchParams.has(key)).toBe(false);
    }
    expect(url.hash).toBe("#book-departure");
    expect(container.querySelector('input[name="personId"]')).toHaveValue(personId);
    expect(screen.getByRole("group", { name: /Jan.*1.*2031/ })).toBeInTheDocument();
  });

  it("holds the later page open and offers the earlier page without changing the diver", () => {
    const { container } = picker(2);
    expect(container.querySelector("details")).toHaveAttribute("open");
    const earlier = screen.getByRole("link", { name: "Earlier departures" });
    const url = new URL(earlier.getAttribute("href") ?? "", "https://example.test");
    expect(url.pathname).toBe(`/shop/blue-mantis/divers/${personId}`);
    expect(url.searchParams.get("bookingPage")).toBe("1");
    expect(screen.getByRole("combobox", { name: "Departure" })).toHaveValue("");
    expect(screen.getByRole("option", { name: /Later reef/ })).toHaveValue(trip.id);
    expect(screen.queryByRole("link", { name: "Later departures" })).not.toBeInTheDocument();
  });

  it("shows an honest empty state and no unusable booking controls when nothing matches", () => {
    const { container } = picker(1, [], 1);
    container.querySelector("details")?.setAttribute("open", "");
    expect(screen.getByText(t("divers.bookActivity.noOpenActivities"))).toBeVisible();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Book" })).not.toBeInTheDocument();
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
  });
});
