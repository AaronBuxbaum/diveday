// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
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

/** Key Largo, the demo shop's own coordinates, in its own zone. */
const SHOP = { timezone: "America/New_York", latitude: 25.0865, longitude: -80.4473 };
/** A shop that never finished its address, so the sky line has nothing to stand on. */
const NO_ADDRESS = { timezone: "America/New_York", latitude: null, longitude: null };
/** 9:00 AM to 12:30 PM Eastern: the two-tank reef trip, home well before dark. */
const MORNING = new Date("2026-01-02T14:00:00Z");
const MIDDAY = new Date("2026-01-02T17:30:00Z");
/** 4:30 PM to 8:00 PM Eastern, over a 5:44 PM sunset: the night charter. */
const AFTER_DARK = new Date("2026-01-02T21:30:00Z");
const HOME_IN_THE_DARK = new Date("2026-01-03T01:00:00Z");

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
        startsAt={MORNING}
        endsAt={MIDDAY}
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
    expect(screen.queryByText(/\d{1,2}:\d{2}/)).not.toBeInTheDocument();
  });

  it("renders nothing when the departure has no dive plan", () => {
    const { container } = render(
      <TripDayPlan
        briefings={[]}
        shop={SHOP}
        startsAt={MORNING}
        endsAt={MIDDAY}
        locale={DEFAULT_DIVER_LOCALE}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("says when the light goes and what moon there is, on a night departure", () => {
    // It casts off in daylight and is still out at sunset, which is what makes
    // it a night dive — the shape of every real night charter.
    render(
      <TripDayPlan
        briefings={[briefing()]}
        shop={SHOP}
        startsAt={AFTER_DARK}
        endsAt={HOME_IN_THE_DARK}
        locale={DEFAULT_DIVER_LOCALE}
      />,
    );
    expect(screen.getByText(/Sunset 5:44 PM, dark by 6:09 PM/)).toBeInTheDocument();
    expect(screen.getByText(/Full moon, 100% lit/)).toBeInTheDocument();
  });

  it("keeps the sky line on a departure whose sites are not picked yet", () => {
    // The one beat that would otherwise be a heading over nothing: sunset is a
    // fact about the departure, not about the sites nobody has chosen.
    render(
      <TripDayPlan
        briefings={[]}
        shop={SHOP}
        startsAt={AFTER_DARK}
        endsAt={HOME_IN_THE_DARK}
        locale={DEFAULT_DIVER_LOCALE}
      />,
    );
    expect(screen.getByText(/Sunset 5:44 PM/)).toBeInTheDocument();
  });

  it("says nothing about the sky when the shop has set no address", () => {
    const { container } = render(
      <TripDayPlan
        briefings={[]}
        shop={NO_ADDRESS}
        startsAt={AFTER_DARK}
        endsAt={HOME_IN_THE_DARK}
        locale={DEFAULT_DIVER_LOCALE}
      />,
    );
    expect(container).toBeEmptyDOMElement();
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
