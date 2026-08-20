// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BookableDiver } from "@/db/divers";
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
    expect(screen.getAllByRole("link", { name: "Add diver" }).at(-1)).toHaveAttribute(
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
    expect(screen.getAllByRole("link", { name: "Add diver" })[1]).toHaveAttribute(
      "href",
      "/shop/blue-mantis/divers/new?name=Nobody+Here&surface=trip-guests&tripId=trip-1",
    );
  });

  it("keeps one add diver button when matching returning divers are listed", () => {
    const candidate = {
      person: { id: "person-1", fullName: "Avery Diver", email: "avery@example.com" },
      rentalFit: null,
    } as unknown as BookableDiver;

    render(
      <AddDiverSection
        shopSlug="blue-mantis"
        tripId="trip-1"
        full={false}
        query="Avery"
        candidates={[candidate]}
        addBookingAction={action}
        addToWaitlistAction={action}
        addExistingDiverAction={action}
        locale="en-US"
      />,
    );

    expect(screen.getByText("Avery Diver")).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "Add diver" })).toHaveLength(1);
    expect(screen.queryByText("Not listed?")).toBeNull();
  });
});
