// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AddDiverSection } from "./AddDiverSection";

vi.mock("next/navigation", () => ({
  usePathname: () => "/shop/blue-mantis/trips/trip-1/guests",
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));

afterEach(cleanup);

const action = (_formData: FormData) => {};

describe("AddDiverSection hand-entry disclosure", () => {
  it("starts collapsed before staff search for a new diver", () => {
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

    const handEntry = document.getElementById("hand-entry");
    expect(handEntry).toBeInstanceOf(HTMLDetailsElement);
    expect((handEntry as HTMLDetailsElement).open).toBe(false);
  });
});
