// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { FIRST_RUN_STEP_COUNT } from "@/lib/onboarding";
import { FirstRunChecklist, type FirstRunChecklistCopy } from "./FirstRunChecklist";

afterEach(() => {
  cleanup();
});

const COPY: FirstRunChecklistCopy = {
  groupLabel: "First morning",
  subtitle: "Seven steps and divers can start booking.",
  progress: "2 of 7 done",
  contactTitle: "Add your contact details",
  contactBody: "Phone and email so divers — and DiveDay — can reach you.",
  contactAction: "Add contact details",
  contactDone: "Contact details on file.",
  profileTitle: "Add your shop profile & branding",
  profileBody: "A tagline, description, and logo for your public schedule.",
  profileAction: "Set up profile",
  profileDone: "Shop profile configured.",
  unitsTitle: "Check your currency and depth unit",
  unitsBody: "We started you on USD and feet from your timezone.",
  unitsAction: "Check units",
  unitsDone: "Units confirmed.",
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
        profileDone={false}
        diveSiteCount={0}
        unitsDone={false}
        stripeDone={false}
        copy={COPY}
      />,
    );

    expect(screen.getByRole("heading", { name: "First morning" })).toBeInTheDocument();
    expect(screen.queryByText("Done")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Add contact details" })).toHaveAttribute(
      "href",
      "/shop/blue-mantis/settings#contact",
    );
    // The **library**, not its blank form: a shop with no sites is offered two
    // doors there — write one, or copy a published template — and landing on
    // the form has already chosen for them (slice 10d,
    // ADR 20260827-the-shops-shelves).
    expect(screen.getByRole("link", { name: "Add a dive site" })).toHaveAttribute(
      "href",
      "/shop/blue-mantis/dive-sites",
    );
    expect(screen.getByRole("link", { name: "Schedule a trip" })).toHaveAttribute(
      "href",
      "/shop/blue-mantis/schedule/board?add=1",
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
        profileDone={true}
        diveSiteCount={3}
        unitsDone={false}
        stripeDone={true}
        copy={COPY}
      />,
    );

    expect(screen.getByText("Contact details on file.")).toBeInTheDocument();
    expect(screen.getByText("Shop profile configured.")).toBeInTheDocument();
    expect(screen.getByText("Stripe connected.")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Add contact details" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Set up profile" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Connect Stripe" })).not.toBeInTheDocument();
    // The trip step is never done at render time — the whole checklist only
    // renders while the shop has no upcoming departure.
    expect(screen.getByRole("link", { name: "Schedule a trip" })).toBeInTheDocument();
  });
});

/**
 * **A derived default nobody looked at is the same failure with extra steps.**
 *
 * Onboarding now starts a shop on the currency and depth unit its timezone
 * implies (issue #712). Both are expensive to get wrong later: `price_cents`
 * counts the *current* currency's minor unit, so a `usd → mxn` switch turns
 * ninety-five dollars into ninety-five pesos with no migration, and a depth
 * typed under the wrong unit was converted on the way in. So the guess is put
 * in front of the shop before it has priced anything.
 */
describe("the step count", () => {
  /**
   * **The subtitle counts the steps, so something has to hold it to them.**
   *
   * It read "Five steps and divers can start booking" while the list grew a
   * sixth (issue #712). The count is interpolated now, and this is what stops
   * the constant behind it drifting from the list it describes.
   */
  it("renders exactly the number of steps the subtitle promises", () => {
    render(
      <FirstRunChecklist
        shopSlug="blue-mantis"
        scheduleUrl="https://app.diveday.example/s/blue-mantis"
        contactDone={false}
        profileDone={false}
        diveSiteCount={0}
        unitsDone={false}
        stripeDone={false}
        copy={COPY}
      />,
    );

    // Five rows contribute persisted progress; trip and schedule are guided
    // actions and remain visible without pretending they can be checked off.
    expect(screen.getAllByRole("listitem")).toHaveLength(FIRST_RUN_STEP_COUNT + 2);
  });
});

/**
 * **Exactly one open step carries the page's one primary** — the day-zero half
 * of ADR 20260827-clearwater-surface-language's slice 6c, where the setup
 * ledger *is* the shop home. Seven rows each offering a primary-weight button
 * is seven next actions, which is none.
 */
describe("the one next thing", () => {
  const render7 = (done: Partial<Parameters<typeof FirstRunChecklist>[0]> = {}) =>
    render(
      <FirstRunChecklist
        shopSlug="blue-mantis"
        scheduleUrl="https://app.diveday.example/s/blue-mantis"
        contactDone={false}
        profileDone={false}
        diveSiteCount={0}
        unitsDone={false}
        stripeDone={false}
        copy={COPY}
        {...done}
      />,
    );

  it("marks one step, and only one, as the primary", () => {
    const { container } = render7();
    const primaries = container.querySelectorAll('[data-first-run-primary="true"]');
    expect(primaries).toHaveLength(1);
    expect(primaries[0]).toHaveTextContent("Add contact details");
  });

  it("moves the primary to the next unfinished step rather than adding a second", () => {
    const { container } = render7({ contactDone: true, profileDone: true });
    const primaries = container.querySelectorAll('[data-first-run-primary="true"]');
    expect(primaries).toHaveLength(1);
    expect(primaries[0]).toHaveTextContent("Check units");
  });

  it("keeps exactly one once every persisted step is done — the trip is the last", () => {
    // The group only renders while the shop has no departure, so the trip step
    // is always the open one at the end and always has somewhere to send you.
    const { container } = render7({
      contactDone: true,
      profileDone: true,
      unitsDone: true,
      diveSiteCount: 2,
      stripeDone: true,
    });
    const primaries = container.querySelectorAll('[data-first-run-primary="true"]');
    expect(primaries).toHaveLength(1);
    expect(primaries[0]).toHaveTextContent("Schedule a trip");
  });

  it("settles a finished step into a mark with no control left to press", () => {
    render7({ contactDone: true });
    expect(screen.getByText("Contact details on file.")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Add contact details" })).not.toBeInTheDocument();
  });
});

describe("the units step", () => {
  it("names what the shop was started on, so the guess is checkable", () => {
    render(
      <FirstRunChecklist
        shopSlug="blue-mantis"
        scheduleUrl="https://app.diveday.example/s/blue-mantis"
        contactDone={false}
        profileDone={false}
        diveSiteCount={0}
        unitsDone={false}
        stripeDone={false}
        copy={COPY}
      />,
    );

    expect(screen.getByText("Check your currency and depth unit")).toBeInTheDocument();
    // The values themselves, not just an invitation to go and look — a step
    // that says "check your units" without saying what they are makes a shop
    // navigate to find out whether it needs to.
    expect(screen.getByText(/USD and feet/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Check units" })).toHaveAttribute(
      "href",
      "/shop/blue-mantis/settings#units",
    );
  });

  it("settles once the shop has saved them", () => {
    render(
      <FirstRunChecklist
        shopSlug="blue-mantis"
        scheduleUrl="https://app.diveday.example/s/blue-mantis"
        contactDone={false}
        profileDone={false}
        diveSiteCount={0}
        unitsDone
        stripeDone={false}
        copy={COPY}
      />,
    );

    expect(screen.getByText("Units confirmed.")).toBeInTheDocument();
    expect(screen.queryByText(/USD and feet/)).toBeNull();
  });
});

/**
 * **The open steps that are not next are doors, not buttons** — ADR
 * 20260827-first-light, decision 6, and principle 10's "actions ride on their
 * objects". The rule the shipped checklist broke: six secondary buttons beside
 * one primary is a row of things to press, and the reader has to read all seven
 * to find the one that matters.
 */
describe("one primary, and the rest are the rows themselves", () => {
  const renderFresh = (done: Partial<Parameters<typeof FirstRunChecklist>[0]> = {}) =>
    render(
      <FirstRunChecklist
        shopSlug="blue-mantis"
        scheduleUrl="https://app.diveday.example/s/blue-mantis"
        contactDone={false}
        profileDone={false}
        diveSiteCount={0}
        unitsDone={false}
        stripeDone={false}
        copy={COPY}
        {...done}
      />,
    );

  it("gives the next step the only button-shaped thing on the group", () => {
    const { container } = renderFresh();
    // `buttonClass`'s primary variant is the one filled control here; every
    // other open step's fix is a link with a chevron.
    const filled = container.querySelectorAll('[data-first-run-primary="true"]');
    expect(filled).toHaveLength(1);
    expect(filled[0]).toHaveTextContent("Add contact details");
  });

  it("makes each other open step a door, its destination named on the row", () => {
    renderFresh();
    // The stretched overlay carries the name — so the row *is* the link, and a
    // reader tabbing through hears where it goes.
    for (const [name, href] of [
      ["Set up profile", "/shop/blue-mantis/settings#profile"],
      ["Check units", "/shop/blue-mantis/settings#units"],
      ["Add a dive site", "/shop/blue-mantis/dive-sites"],
      ["Schedule a trip", "/shop/blue-mantis/schedule/board?add=1"],
    ] as const) {
      expect(screen.getByRole("link", { name })).toHaveAttribute("href", href);
    }
  });

  it("keeps Stripe's fix a plain anchor beside the row, never the row itself", () => {
    // The one step that cannot be a door: its route 302s to Stripe's OAuth
    // authorize URL, which Next's client navigation would follow via fetch and
    // Stripe's CORS policy would reject. A full navigation is the whole point,
    // so this link must not be a `<Link>` and must not be stretched over a row.
    renderFresh();
    const stripe = screen.getByRole("link", { name: "Connect Stripe" });
    expect(stripe).toHaveAttribute("href", "/shop/blue-mantis/settings/connect");
    expect(stripe.className).not.toContain("absolute");
  });

  it("leaves a settled step nothing at all to press", () => {
    renderFresh({ contactDone: true, profileDone: true, stripeDone: true });
    expect(screen.queryByRole("link", { name: "Add contact details" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Set up profile" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Connect Stripe" })).not.toBeInTheDocument();
    expect(screen.getByText("Contact details on file.")).toBeInTheDocument();
  });
});
