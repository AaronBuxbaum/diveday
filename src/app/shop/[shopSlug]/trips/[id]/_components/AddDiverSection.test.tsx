// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AddDiverSection } from "./AddDiverSection";

vi.mock("next/navigation", () => ({
  usePathname: () => "/shop/blue-mantis/trips/trip-1/guests",
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));

afterEach(cleanup);

const action = (_formData: FormData) => {};

describe("AddDiverSection", () => {
  it("renders search form and add diver link when trip is not full", () => {
    render(
      <AddDiverSection
        shopSlug="blue-mantis"
        tripId="trip-1"
        full={false}
        query=""
        candidates={[]}
        addBookingAction={action}
        addToWaitlistAction={action}
        addExistingDiverAction={action}
        locale="en-US"
      />,
    );

    expect(screen.getByRole("searchbox")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Add diver" })).toHaveAttribute(
      "href",
      "/shop/blue-mantis/divers/new?surface=trip-guests&tripId=trip-1",
    );
  });

  it("offers waitlist addition directly when trip is full", () => {
    render(
      <AddDiverSection
        shopSlug="blue-mantis"
        tripId="trip-1"
        full={true}
        query=""
        candidates={[]}
        addBookingAction={action}
        addToWaitlistAction={action}
        addExistingDiverAction={action}
        locale="en-US"
      />,
    );

    expect(screen.getByRole("link", { name: "Add to wait list" })).toHaveAttribute(
      "href",
      "/shop/blue-mantis/divers/new?surface=trip-guests&tripId=trip-1&waitlist=true",
    );
  });

  it("offers direct add-diver link with prefill when no matches are found", () => {
    render(
      <AddDiverSection
        shopSlug="blue-mantis"
        tripId="trip-1"
        full={false}
        query="Nobody Here"
        candidates={[]}
        addBookingAction={action}
        addToWaitlistAction={action}
        addExistingDiverAction={action}
        locale="en-US"
      />,
    );

    expect(screen.getByText("No returning diver matches “Nobody Here”.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Add “Nobody Here” as a diver" })).toHaveAttribute(
      "href",
      "/shop/blue-mantis/divers/new?name=Nobody+Here&surface=trip-guests&tripId=trip-1",
    );
  });
});
