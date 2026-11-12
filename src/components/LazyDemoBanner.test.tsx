// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { LazyDemoBanner } from "./LazyDemoBanner";

afterEach(cleanup);

const COPY = {
  shopLabel: "Demo shop",
  viewingAs: "Viewing as",
  switchRole: "Switch role",
  sharedWarning: "",
  current: "Current",
  switchAction: "",
  switchFailed: "",
  startTitle: "Start here",
  startCaptain: "Call the roll as the captain",
  startDesk: "Check a diver in at the desk",
  startDiver: "Book a seat as a diver",
  dismissStarts: "Dismiss starting places",
};

describe("LazyDemoBanner", () => {
  it("loads and draws the banner where a demo shop renders it", async () => {
    render(
      <LazyDemoBanner
        currentRole="owner"
        currentName="Dana Reyes"
        shopSlug="demo"
        roles={[{ id: "owner", name: "Dana Reyes", title: "Owner", switchAriaLabel: "" }]}
        copy={COPY}
        switchRole={async () => {}}
      />,
    );
    expect(await screen.findByText("Demo shop")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Switch role/ })).toBeInTheDocument();
  });
});
