// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { FirstRunChecklist, type FirstRunChecklistCopy } from "./FirstRunChecklist";

afterEach(() => {
  cleanup();
});

const COPY: FirstRunChecklistCopy = {
  heading: "Get your shop ready",
  subtitle: "Five steps and divers can start booking.",
  contactTitle: "Add your contact details",
  contactBody: "Phone and email so divers — and DiveDay — can reach you.",
  contactAction: "Add contact details",
  contactDone: "Contact details on file.",
  siteTitle: "Add your first dive site",
  siteBody: "The place you’ll pin your trips to.",
  siteAction: "Add a dive site",
  siteDone: "{count} dive sites added.",
  tripTitle: "Schedule your first trip",
  tripBody: "Put a departure on the board — divers can’t book until one exists.",
  tripAction: "Schedule a trip",
  scheduleTitle: "Share your public schedule",
  scheduleBody: "The page divers actually book from.",
  scheduleCopy: "Copy link",
  scheduleCopied: "Copied",
  scheduleCopyFailed: "Couldn’t copy",
  stripeTitle: "Connect Stripe (optional)",
  stripeBody: "Take payment online.",
  stripeAction: "Connect Stripe",
  stripeDone: "Stripe connected.",
  doneBadge: "Done",
};

describe("FirstRunChecklist", () => {
  it("shows every step as not-done for a brand-new shop", () => {
    render(
      <FirstRunChecklist
        shopSlug="blue-mantis"
        scheduleUrl="https://app.diveday.example/s/blue-mantis"
        contactDone={false}
        diveSiteCount={0}
        stripeDone={false}
        copy={COPY}
      />,
    );

    expect(screen.getByRole("heading", { name: "Get your shop ready" })).toBeInTheDocument();
    expect(screen.queryByText("Done")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Add contact details" })).toHaveAttribute(
      "href",
      "/shop/blue-mantis/settings",
    );
    expect(screen.getByRole("link", { name: "Add a dive site" })).toHaveAttribute(
      "href",
      "/shop/blue-mantis/dive-sites/new",
    );
    expect(screen.getByRole("link", { name: "Schedule a trip" })).toHaveAttribute(
      "href",
      "/shop/blue-mantis/trips/new",
    );
    expect(screen.getByRole("link", { name: "Connect Stripe" })).toHaveAttribute(
      "href",
      "/shop/blue-mantis/settings/connect",
    );
    expect(screen.getByText("https://app.diveday.example/s/blue-mantis")).toBeInTheDocument();
  });

  it("marks a step done from real data instead of a dismiss flag", () => {
    render(
      <FirstRunChecklist
        shopSlug="blue-mantis"
        scheduleUrl="https://app.diveday.example/s/blue-mantis"
        contactDone={true}
        diveSiteCount={3}
        stripeDone={true}
        copy={COPY}
      />,
    );

    expect(screen.getByText("Contact details on file.")).toBeInTheDocument();
    expect(screen.getByText("Stripe connected.")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Add contact details" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Connect Stripe" })).not.toBeInTheDocument();
    // The trip step is never done at render time — the whole checklist only
    // renders while the shop has no upcoming departure.
    expect(screen.getByRole("link", { name: "Schedule a trip" })).toBeInTheDocument();
  });
});
