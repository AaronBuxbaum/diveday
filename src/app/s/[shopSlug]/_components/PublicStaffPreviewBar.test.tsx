// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PublicStaffPreviewBar } from "./PublicStaffPreviewBar";

const route = vi.hoisted(() => ({ pathname: "/s/blue-mantis" }));
vi.mock("next/navigation", () => ({ usePathname: () => route.pathname }));
afterEach(cleanup);
const words = {
  short: "Divers see this page.",
  long: "You work here.",
  board: "Open the board",
  manage: "Manage this trip",
};
describe("the authorized public preview return door", () => {
  it("offers one direct trip return and follows client navigation back to the board", () => {
    route.pathname = "/s/blue-mantis/trips/selected-trip";
    const view = render(<PublicStaffPreviewBar shopSlug="blue-mantis" words={words} />);
    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(screen.getByRole("link", { name: "Manage this trip" })).toHaveAttribute(
      "href",
      "/shop/blue-mantis/trips/selected-trip",
    );
    expect(screen.queryByRole("link", { name: "Open the board" })).toBeNull();
    route.pathname = "/s/blue-mantis/courses";
    view.rerender(<PublicStaffPreviewBar shopSlug="blue-mantis" words={words} />);
    expect(screen.getByRole("link", { name: "Open the board" })).toHaveAttribute(
      "href",
      "/shop/blue-mantis/schedule/board",
    );
  });
  it.each(["/s/other-shop/trips/id", "/s/blue-mantis/trips/id/other", "/s/blue-mantis"])(
    "keeps the known shop board for non-trip route %s",
    (pathname) => {
      route.pathname = pathname;
      render(<PublicStaffPreviewBar shopSlug="blue-mantis" words={words} />);
      expect(screen.getByRole("link")).toHaveAttribute("href", "/shop/blue-mantis/schedule/board");
    },
  );
});
