// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_DIVER_LOCALE } from "@/i18n/settings";
import { TripDayPlan, TripLookFor, TripMoments, TripSiteNotes } from "./TripDayPlan";
import type { DiveBriefing } from "./types";

/**
 * The pitch, above the form: the run of dives and the faces the shop put on
 * those sites (ADR 20260827-the-divers-thread, decision 2). Both beats are
 * silent when there is nothing to say — an empty "Look for" is a heading
 * apologising for its own emptiness.
 */

afterEach(cleanup);

const SHOP = { slug: "blue-mantis", timezone: "America/New_York" };

function briefing(overrides: Partial<DiveBriefing> = {}): DiveBriefing {
  return {
    dive: { id: "dive-1", diveNumber: 1, title: "French Reef swim-throughs" },
    diveSite: { id: "site-1", name: "French Reef", depthRange: "to 12 m" },
    creatures: [],
    moments: [],
    ...overrides,
  } as unknown as DiveBriefing;
}

describe("TripDayPlan", () => {
  it("lists the dives in plan order with their depths, and no clock", () => {
    render(
      <TripDayPlan
        briefings={[
          briefing(),
          briefing({
            dive: {
              id: "dive-2",
              diveNumber: 2,
              title: "White Sand Bottom Cave",
            },
            diveSite: { id: "site-2", name: "White Sand", depthRange: "to 14 m" },
          } as unknown as DiveBriefing),
        ]}
        shop={SHOP}
        locale={DEFAULT_DIVER_LOCALE}
      />,
    );

    expect(screen.getByText("The day")).toBeInTheDocument();
    expect(screen.getByText("Dive 1")).toBeInTheDocument();
    expect(screen.getByText("French Reef swim-throughs")).toBeInTheDocument();
    expect(screen.getByText("to 12 m")).toBeInTheDocument();
    expect(screen.getByText("Dive 2")).toBeInTheDocument();
    // Time-neutral: a dive plan's clock belongs to the day itself, on the
    // thread. A schedule beside a Book button reads as a promise the crew has
    // not made.
    const dives = screen.getByRole("list");
    expect(within(dives).queryByText(/\d{1,2}:\d{2}/)).not.toBeInTheDocument();
  });

  /**
   * **The row is the door to its site** (pixel-craft class 7, K-168). The
   * site's name was an inline link inside a plain row: a 17px-tall target
   * ("French Reef" 79×17 at 390), its ring hugging the words. The row now opens
   * the site's page whichever line names it — the dive's own name, or the
   * site under a dive the shop named itself — and a dive with no site yet stays
   * a plain row.
   */
  it("makes a dive with a site the door to that site's page, and leaves one without a plain row", () => {
    render(
      <TripDayPlan
        briefings={[
          briefing({
            diveSite: { id: "site-1", slug: "french-reef", name: "French Reef" },
          } as unknown as Partial<DiveBriefing>),
          briefing({
            dive: { id: "dive-2", diveNumber: 2, title: "Wreck penetration" },
            diveSite: null,
          } as unknown as Partial<DiveBriefing>),
        ]}
        shop={SHOP}
        locale={DEFAULT_DIVER_LOCALE}
      />,
    );
    const dives = screen.getByRole("list");
    const links = within(dives).getAllByRole("link");
    expect(links).toHaveLength(1);
    const [door] = links;
    expect(door).toHaveAccessibleName("French Reef");
    expect(door).toHaveAttribute("href", "/s/blue-mantis/sites/french-reef");
    // The row's own stretched door, not a link on the words.
    expect(door).toHaveClass("absolute", "inset-0");
    expect(door.closest("li")).toHaveTextContent("French Reef swim-throughs");
    expect(door.closest("li")).toHaveTextContent("French Reef");
    expect(within(dives).getByText("Wreck penetration").closest("li")).not.toContainElement(door);
  });

  it("says nothing on a departure with no dives planned", () => {
    const { container } = render(
      <TripDayPlan briefings={[]} shop={SHOP} locale={DEFAULT_DIVER_LOCALE} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});

/**
 * **The day's profile, before anybody has booked** (issue #1479).
 *
 * Two facts the shop already publishes and the page never said — how long each
 * dive runs, and how long the day sits on the surface between two of them — and
 * one question a page with no diver on file can still answer: does this day go
 * deeper than the card I hold?
 */
describe("TripDayPlan's profile", () => {
  const profile = {
    rhythm: {
      dockCallMinutes: 30,
      gearSetupMinutes: 0,
      briefingMinutes: 15,
      boatRideMinutes: 20,
      bottomTimeMinutes: 45,
      surfaceIntervalMinutes: 60,
    },
    depthUnit: "meters",
    diveMode: "boat",
    dayCount: 1,
  } as const;

  const wall = briefing({
    dive: { id: "dive-2", diveNumber: 2, title: null },
    diveSite: { id: "site-2", name: "Spiegel Grove", depthRange: "18–40 m", maxDepthMeters: 40 },
  } as unknown as Partial<DiveBriefing>);

  it("states the time in the water and the gap between two dives", () => {
    render(
      <TripDayPlan
        briefings={[briefing(), wall]}
        shop={SHOP}
        locale={DEFAULT_DIVER_LOCALE}
        profile={profile}
      />,
    );
    expect(screen.getAllByText("Usually 45 minutes in the water")).toHaveLength(2);
    expect(screen.getByText("Usually 60 minutes on the surface")).toBeInTheDocument();
    // Durations, not a clock: the day's hours belong to the booked diver's own
    // thread, and a schedule beside a Book button reads as a promise.
    expect(within(screen.getByRole("list")).queryByText(/\d{1,2}:\d{2}/)).not.toBeInTheDocument();
  });

  /**
   * **The run closes itself unless the next thing on the page is a rule**
   * (pixel-craft class 6). On a bare day — no crew months, a pitch that opens
   * on its door — the run's closing rule sat 32px over the door's own, two
   * parallel hairlines with nothing between them, so the page may leave it
   * open. Anything under the list inside this section (the months' caption)
   * is not a rule, and the run closes over it.
   */
  const lines = () => [...screen.getByRole("list").children];

  it("asks the reader nothing about their card, even on a deep day", () => {
    render(
      <TripDayPlan
        briefings={[briefing(), wall]}
        shop={SHOP}
        locale={DEFAULT_DIVER_LOCALE}
        profile={profile}
      />,
    );
    // The depth-against-your-card picker was cut (Aaron, 2026-10-05): the
    // depths stay on each dive's row, and the booking form asks the card.
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.queryByText(/your card/)).not.toBeInTheDocument();
    expect(screen.getByText("18–40 m")).toBeInTheDocument();
  });

  it("leaves a bare run open when the page says a rule follows it", () => {
    const secondDive = briefing({
      dive: { id: "dive-2", diveNumber: 2, title: "White Sand Bottom Cave" },
      diveSite: { id: "site-2", name: "White Sand", depthRange: "to 14 m" },
    } as unknown as Partial<DiveBriefing>);
    const { rerender } = render(
      <TripDayPlan
        briefings={[briefing(), secondDive]}
        shop={SHOP}
        locale={DEFAULT_DIVER_LOCALE}
        profile={profile}
        nextOpensOnRule
      />,
    );
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    // Two dives and the surface interval between them, hand-set line and all.
    expect(lines()).toHaveLength(3);
    for (const line of lines()) {
      expect(line).toHaveClass("border-t");
      expect(line).not.toHaveClass("last:border-b");
    }
    rerender(
      <TripDayPlan
        briefings={[briefing(), secondDive]}
        shop={SHOP}
        locale={DEFAULT_DIVER_LOCALE}
        profile={profile}
      />,
    );
    for (const line of lines()) expect(line).toHaveClass("last:border-b");
  });

  it("says nothing about a surface interval on a one-tank day", () => {
    render(
      <TripDayPlan
        briefings={[briefing()]}
        shop={SHOP}
        locale={DEFAULT_DIVER_LOCALE}
        profile={profile}
      />,
    );
    expect(screen.queryByText(/on the surface/)).not.toBeInTheDocument();
  });
});

describe("TripLookFor", () => {
  const creatures = [
    {
      id: "c1",
      slug: "stoplight-parrotfish",
      name: "Stoplight parrotfish",
      description: "A reef fish with a face that changes as it grows.",
      preparationTip: "Look along the coral edge and let it come to you.",
      imageUrl: "/marine-life/stoplight-parrotfish.jpg",
    },
    {
      id: "c2",
      slug: "green-sea-turtle",
      name: "Green turtle",
      description: "A calm grazer often seen moving over the reef.",
      preparationTip: "Watch the sand beside the reef for a slow, steady glide.",
      imageUrl: "/marine-life/green-turtle.jpg",
    },
  ] as unknown as DiveBriefing["creatures"];

  it("names the species once each, however many dives share a site", () => {
    render(
      <TripLookFor
        briefings={[briefing({ creatures }), briefing({ creatures })]}
        locale={DEFAULT_DIVER_LOCALE}
      />,
    );

    expect(screen.getByText("Look for")).toBeInTheDocument();
    expect(screen.getAllByText("Stoplight parrotfish")).toHaveLength(1);
    expect(screen.getAllByText("Green turtle")).toHaveLength(1);
    expect(
      screen.getByText("A reef fish with a face that changes as it grows."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Look along the coral edge and let it come to you."),
    ).toBeInTheDocument();
  });

  it("shows each species' face as a decorative photo beside its name", () => {
    render(<TripLookFor briefings={[briefing({ creatures })]} locale={DEFAULT_DIVER_LOCALE} />);
    // The visible name is the content; the bundled catalog photo beside it is
    // decorative (alt=""), so a screen reader hears each species exactly once.
    const images = screen.getAllByRole("presentation");
    expect(images).toHaveLength(2);
    for (const image of images) expect(image).toHaveAttribute("alt", "");
  });

  it("renders nothing when no site names a species", () => {
    const { container } = render(
      <TripLookFor briefings={[briefing()]} locale={DEFAULT_DIVER_LOCALE} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});

/**
 * **Every beat's label sits 8px over what it labels** (pixel-craft class 4,
 * K-509). The route and the site notes open `mt-2` under their `GroupLabel`;
 * "Look for" and "Moments from divers" opened `mt-3`, and floated 12–13px
 * above their content on the trip's door and the dive-site page alike. The
 * site page's departures stood `mt-8` under beats that stand `mt-6`.
 */
describe("the day's beats", () => {
  const creatures = [
    { id: "c1", slug: "green-sea-turtle", name: "Green turtle", imageUrl: "/turtle.jpg" },
  ] as unknown as DiveBriefing["creatures"];
  const moments = [
    { id: "m1", caption: "A ray disappearing into the blue.", imageUrl: "/dive-sites/ray.jpg" },
  ] as unknown as DiveBriefing["moments"];

  it.each([
    ["Look for", () => <TripLookFor briefings={[briefing({ creatures })]} locale="en-US" />],
    [
      "Moments from divers",
      () => <TripMoments briefings={[briefing({ moments })]} locale="en-US" />,
    ],
  ])("opens %s's content 8px under its label", (label, Beat) => {
    render(<Beat />);
    const heading = screen.getByRole("heading", { level: 2, name: label });
    expect(heading.nextElementSibling).toHaveClass("mt-2");
    expect(heading.nextElementSibling).not.toHaveClass("mt-3");
    expect(heading.closest("section")).toHaveClass("mt-6");
  });

  it("stands the dive-site page's departures where its other beats stand", () => {
    const page = readFileSync(
      join(__dirname, "..", "..", "..", "sites", "[siteSlug]", "page.tsx"),
      "utf8",
    );
    const departures = page.match(/<section id="departures" className="([^"]*)"/)?.[1];
    expect(departures).toBe("mt-6 scroll-mt-8");
  });
});

/**
 * The diver photos a staffer published for the day's sites finally reach the
 * page (they were fetched and rendered nowhere from slice 7c until the
 * 2026-08-28 diver-views design review). Capped, deduplicated by site, silent
 * when there are none.
 */
describe("TripMoments", () => {
  const moments = [
    { id: "m1", caption: "A ray disappearing into the blue.", imageUrl: "/dive-sites/ray.jpg" },
    { id: "m2", caption: "The winch at 12 m.", imageUrl: null },
  ] as unknown as DiveBriefing["moments"];

  it("shows each published photo once with its caption, skipping photoless rows", () => {
    render(
      // The same site on both tanks: its moments must not double.
      <TripMoments
        briefings={[briefing({ moments }), briefing({ moments })]}
        locale={DEFAULT_DIVER_LOCALE}
      />,
    );
    expect(screen.getByText("Moments from divers")).toBeInTheDocument();
    expect(screen.getAllByText("A ray disappearing into the blue.")).toHaveLength(1);
    // A moment with no photo is a caption about nothing here; it stays off.
    expect(screen.queryByText("The winch at 12 m.")).not.toBeInTheDocument();
    // The caption is the accessible content; the photo is decorative.
    expect(screen.getByRole("presentation")).toHaveAttribute("alt", "");
  });

  /**
   * **A photo that fills the measure takes the panel's corner** (pixel-craft
   * class 12, K-510). One moment is the column's full width, beside the hero
   * and the route card's 20px corners, and drew the two-up grid's 12px inset
   * corner there; in a pair it is a tile, and keeps it.
   */
  it("rounds a lone photo as a panel and a pair as tiles", () => {
    const photo = (id: string) => ({ id, caption: `Moment ${id}`, imageUrl: `/m/${id}.jpg` });
    const { rerender } = render(
      <TripMoments
        briefings={[briefing({ moments: [photo("a")] } as unknown as Partial<DiveBriefing>)]}
        locale={DEFAULT_DIVER_LOCALE}
      />,
    );
    // `StoredPhoto` draws the corner on the box round the image.
    const box = (image: HTMLElement) => image.parentElement;
    expect(box(screen.getByRole("presentation"))).toHaveClass("rounded-panel");
    expect(box(screen.getByRole("presentation"))).not.toHaveClass("rounded-inset");
    rerender(
      <TripMoments
        briefings={[
          briefing({ moments: [photo("a"), photo("b")] } as unknown as Partial<DiveBriefing>),
        ]}
        locale={DEFAULT_DIVER_LOCALE}
      />,
    );
    for (const tile of screen.getAllByRole("presentation")) {
      expect(box(tile)).toHaveClass("rounded-inset");
      expect(box(tile)).not.toHaveClass("rounded-panel");
    }
  });

  it("renders nothing when no site has a published photo", () => {
    const { container } = render(
      <TripMoments briefings={[briefing()]} locale={DEFAULT_DIVER_LOCALE} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});

/**
 * **The shop's own words about a site reach a diver.** ADR
 * 20260813-dive-site-briefings-are-the-shops-own-words rests on that sentence,
 * and slice 7c broke it by deleting the deck the prose lived in — leaving eight
 * authored columns, a staff form that still asks for all of them, and 34 site
 * templates that still ship them, reaching nobody.
 */
describe("TripSiteNotes", () => {
  const site = {
    id: "site-1",
    name: "French Reef",
    depthRange: "to 12 m",
    fitTone: "welcoming",
    fitNote: "A gentle mooring; we run it crew-led for anyone out of practice.",
    divePlan: "Drop on the mooring, work the spur-and-groove north, return along the sand.",
    currentNote: "Usually slack; a light north set on an outgoing tide.",
    marineLife: "Green turtles · spotted eagle rays",
    marineLifeDescription: "Work the sandy edge for turtles resting under the coral heads.",
    conservationNote: "The elkhorn is recovering — nothing touches it.",
    landmarks: [{ name: "The Christ statue", kind: "underwaterMonument", note: "Bronze, at 8 m." }],
  };

  it("renders every field the staff form writes, with no canned filler between them", () => {
    render(
      <TripSiteNotes
        briefings={[briefing({ diveSite: site } as unknown as Partial<DiveBriefing>)]}
        locale={DEFAULT_DIVER_LOCALE}
      />,
    );

    expect(screen.getByText(/Welcoming dive/)).toBeInTheDocument();
    // The tone's standing explainer sentence is gone (2026-08-28 design
    // review): the fit word states the fit, and every sentence under it is the
    // shop's own.
    expect(screen.queryByText(/approachable crew-led day/)).not.toBeInTheDocument();
    // So are the captions that restated the prose beneath them.
    expect(screen.queryByText("How the dive unfolds")).not.toBeInTheDocument();
    expect(screen.queryByText("Water movement")).not.toBeInTheDocument();
    expect(screen.getByText(site.fitNote)).toBeInTheDocument();
    expect(screen.getByText(site.divePlan)).toBeInTheDocument();
    expect(screen.getByText(site.currentNote)).toBeInTheDocument();
    expect(screen.getByText(site.marineLife)).toBeInTheDocument();
    expect(screen.getByText(site.marineLifeDescription)).toBeInTheDocument();
    expect(screen.getByText(site.marineLifeDescription)).toBeInTheDocument();
    expect(screen.getByText("The Christ statue")).toBeInTheDocument();
    expect(screen.getByText("Bronze, at 8 m.")).toBeInTheDocument();
    expect(screen.getByText(site.conservationNote)).toBeInTheDocument();
  });

  it("says what you might see once — the picked species win over the free text", () => {
    render(
      <TripSiteNotes
        briefings={[
          briefing({
            diveSite: site,
            creatures: [{ id: "c1", name: "Stoplight parrotfish" }],
          } as unknown as Partial<DiveBriefing>),
        ]}
        locale={DEFAULT_DIVER_LOCALE}
      />,
    );
    // "Look for" above already names the species the shop picked; repeating the
    // free-text twin here is the same answer in two voices.
    expect(screen.queryByText(site.marineLife)).not.toBeInTheDocument();
    expect(screen.queryByText(site.marineLifeDescription)).not.toBeInTheDocument();
    expect(screen.queryByText(site.marineLifeDescription)).not.toBeInTheDocument();
    expect(screen.queryByText("What to look for down there")).not.toBeInTheDocument();
  });

  it("says a site's own words once on a two-tank day at one mooring", () => {
    render(
      <TripSiteNotes
        briefings={[
          briefing({ diveSite: site } as unknown as Partial<DiveBriefing>),
          briefing({
            dive: { id: "dive-2", diveNumber: 2, title: null },
            diveSite: site,
          } as unknown as Partial<DiveBriefing>),
        ]}
        locale={DEFAULT_DIVER_LOCALE}
      />,
    );
    expect(screen.getAllByText(site.divePlan)).toHaveLength(1);
  });

  it("renders nothing for a site the shop has written nothing about", () => {
    const { container } = render(
      <TripSiteNotes briefings={[briefing()]} locale={DEFAULT_DIVER_LOCALE} />,
    );
    // A canned fit sentence over a bare name is the page talking to fill space.
    expect(container).toBeEmptyDOMElement();
  });
});
