// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  RoleOrientationCard,
  type RoleOrientationCardCopy,
  RoleOrientationLine,
} from "./RoleOrientationCard";

afterEach(() => {
  cleanup();
});

const COPY: RoleOrientationCardCopy = {
  heading: "New here? A few pointers for your role.",
  subtitle: "This only shows once — dismiss it any time.",
  tryLabel: "Try:",
  dismiss: "Got it",
  title: "You're steering the whole shop",
  desc: "Today is your work queue.",
  tryThis: "Open Board to see this week's departures.",
};

const dismissAction = async () => {};

describe("RoleOrientationCard", () => {
  it("renders the full quiet-day card: heading, role pointer, tour link, dismissal", () => {
    render(
      <RoleOrientationCard
        tourHref="/shop/blue-mantis/schedule/board"
        dismissAction={dismissAction}
        copy={COPY}
      />,
    );

    expect(
      screen.getByRole("heading", { name: "New here? A few pointers for your role." }),
    ).toBeInTheDocument();
    expect(screen.getByText("You're steering the whole shop")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Open Board to see this week's departures." }),
    ).toHaveAttribute("href", "/shop/blue-mantis/schedule/board");
    expect(screen.getByRole("button", { name: "Got it" })).toBeInTheDocument();
  });
});

describe("RoleOrientationLine", () => {
  it("keeps the pointer link and the same dismissal in one line, with no card heading", () => {
    // The busy-day form: same copy keys, no section heading — the queue below
    // it is the page's one idea, and this must never out-rank it.
    render(
      <RoleOrientationLine
        tourHref="/shop/blue-mantis/schedule/board"
        dismissAction={dismissAction}
        copy={{ heading: COPY.heading, dismiss: COPY.dismiss, tryThis: COPY.tryThis }}
      />,
    );

    expect(screen.queryByRole("heading")).not.toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Open Board to see this week's departures." }),
    ).toHaveAttribute("href", "/shop/blue-mantis/schedule/board");
    expect(screen.getByRole("button", { name: "Got it" })).toBeInTheDocument();
  });
});
