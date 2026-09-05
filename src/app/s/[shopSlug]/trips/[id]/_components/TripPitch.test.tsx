// @vitest-environment jsdom
import { cleanup, render, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { PublicCrewMember } from "@/db/trips";
import { DEFAULT_DIVER_LOCALE } from "@/i18n/settings";
import { TripPitch } from "./TripPitch";
import type { DiveBriefing } from "./types";

/**
 * **The composition test the ADR asks for** (20260904-reef-all-the-way-down,
 * decision 1: "the booking page is bounded to three field-guide tiles and a
 * door above the form, with a composition test that refuses more").
 *
 * It reads the rendered tree rather than the source, because what is being
 * pinned is a *shape*: how many tiles, how many top-level children, and that
 * every beat the door swallowed is actually inside the door rather than beside
 * it. `page.composition.test.ts` is the other half — it bounds what may run
 * between the hero and the form at all.
 *
 * **How this fails when somebody adds a section.** A fourth sibling inside
 * `TripPitch` trips "the block is a fact line, three tiles and one door" with
 * `expected 4 to have length 3`; a fourth tile trips the tile count. Either
 * way the fix is to put the new thing behind the door, which is the deliberate
 * act the ADR is asking for.
 */

afterEach(cleanup);

const CREATURES = [
  "Stoplight parrotfish",
  "Green turtle",
  "Elkhorn coral",
  "Queen angelfish",
  "Nurse shark",
  "Spotted eagle ray",
  "Christmas tree worm",
  "Yellowtail snapper",
  "Hogfish",
  "Southern stingray",
];

function creature(name: string, index: number) {
  return {
    id: `creature-${index}`,
    slug: `creature-${index}`,
    name,
    scientificName: `Testus ${index}`,
    kind: "fish",
    description: `${name} field note.`,
    preparationTip: null,
    imageUrl: `/marine-life/creature-${index}.jpg`,
  } as unknown as DiveBriefing["creatures"][number];
}

function briefing(overrides: Partial<DiveBriefing> = {}): DiveBriefing {
  return {
    dive: { id: "dive-1", diveNumber: 1, title: "French Reef swim-throughs" },
    diveSite: {
      id: "site-1",
      name: "French Reef",
      depthRange: "to 12 m",
      difficultyLevel: "beginner",
      fitTone: null,
      fitNote: "A gentle mooring with a sand channel to follow back.",
      divePlan: null,
      currentNote: null,
      conservationNote: null,
      marineLife: null,
      marineLifeDescription: null,
      landmarks: null,
      routePoints: null,
    },
    creatures: [],
    moments: [],
    ...overrides,
  } as unknown as DiveBriefing;
}

const CREW: PublicCrewMember[] = [
  { firstName: "Yara", tripRole: "divemaster", languages: ["en"] } as unknown as PublicCrewMember,
];

/** A day with everything the pitch can carry: ten species, prose and a consenting crew. */
function fullDay() {
  return render(
    <TripPitch
      briefings={[briefing({ creatures: CREATURES.map(creature) })]}
      crew={CREW}
      locale={DEFAULT_DIVER_LOCALE}
    />,
  );
}

describe("TripPitch", () => {
  it("shows three faces and puts the rest behind the door", () => {
    const { container } = fullDay();
    const tiles = container.querySelectorAll("[data-pitch-tile]");
    expect(tiles).toHaveLength(3);
    expect([...tiles].map((tile) => tile.textContent)).toEqual([
      "Stoplight parrotfish",
      "Green turtle",
      "Elkhorn coral",
    ]);
    // Every other species is still on the page — nothing is deleted, it is one
    // tap away — and none of them is a tile.
    const door = container.querySelector("[data-pitch-door-body]");
    if (!door) throw new Error("expected the pitch to render a door");
    for (const name of CREATURES.slice(3)) {
      expect(within(door as HTMLElement).getByText(name)).toBeInTheDocument();
    }
  });

  it("is a fact line, three tiles and one door, and nothing else", () => {
    // **The bound.** Three children: the day's fit word, the tile grid, the
    // door. A fourth section — a testimonials strip, a second photo band, an
    // upsell — fails here, and the ADR's answer is to open the door instead.
    const { container } = fullDay();
    const block = container.firstElementChild;
    if (!block) throw new Error("expected the pitch to render");
    expect(block.children).toHaveLength(3);
    expect(container.querySelectorAll("details")).toHaveLength(1);
  });

  it("swallows all five beats rather than leaving one beside the tiles", () => {
    const { container } = fullDay();
    const door = container.querySelector("[data-pitch-door-body]") as HTMLElement | null;
    if (!door) throw new Error("expected the pitch to render a door");
    // The rest of the field guide, the shop's own site prose and the crew.
    // Each one used to be a section of the page in its own right.
    for (const heading of ["Look for", "The site", "Who you're diving with"]) {
      const inTheDoor = within(door).getAllByText(heading);
      expect(inTheDoor).toHaveLength(1);
      // …and nowhere else: a beat promoted back out of the door is exactly the
      // regression this slice exists to stop, and `within` cannot see it.
      const anywhere = [...container.querySelectorAll("h2")].filter(
        (node) => node.textContent === heading,
      );
      expect(anywhere).toHaveLength(1);
      expect(door.contains(anywhere[0] as Node)).toBe(true);
    }
  });

  it("counts the species the door is holding, and says nothing when it holds none", () => {
    const { container } = fullDay();
    expect(container.textContent).toContain("7 more species");
    cleanup();
    const short = render(
      <TripPitch
        briefings={[briefing({ creatures: CREATURES.slice(0, 2).map(creature) })]}
        crew={[]}
        locale={DEFAULT_DIVER_LOCALE}
      />,
    );
    expect(short.container.textContent).not.toContain("more species");
  });

  it("renders no door at all when there is nothing behind it", () => {
    // A door with nothing behind it promises the reader something and then
    // costs them a tap to find out there was nothing.
    const { container } = render(
      <TripPitch
        briefings={[
          briefing({
            diveSite: {
              id: "site-1",
              name: "French Reef",
              depthRange: null,
              difficultyLevel: "beginner",
              fitTone: null,
              fitNote: null,
              divePlan: null,
              currentNote: null,
              conservationNote: null,
              marineLife: null,
              marineLifeDescription: null,
              landmarks: null,
              routePoints: null,
            },
          } as unknown as DiveBriefing),
        ]}
        crew={[]}
        locale={DEFAULT_DIVER_LOCALE}
      />,
    );
    expect(container.querySelectorAll("details")).toHaveLength(0);
    // Only the fact chip is left, which is the whole block.
    expect(container.firstElementChild?.children).toHaveLength(1);
  });

  it("renders nothing at all for a bare course session", () => {
    const { container } = render(
      <TripPitch
        briefings={[briefing({ diveSite: null } as unknown as Partial<DiveBriefing>)]}
        crew={[]}
        locale={DEFAULT_DIVER_LOCALE}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("reads the day's most demanding site, never an average of them", () => {
    // A two-tank day whose second tank is the drift is a day that wants recent
    // experience; softening that would be the page taking back a fact the shop
    // stated.
    const { container } = render(
      <TripPitch
        briefings={[
          briefing(),
          briefing({
            dive: { id: "dive-2", diveNumber: 2, title: "The Wall" },
            diveSite: {
              id: "site-2",
              name: "The Wall",
              depthRange: "to 30 m",
              difficultyLevel: "advanced",
              fitTone: null,
              fitNote: null,
              divePlan: null,
              currentNote: null,
              conservationNote: null,
              marineLife: null,
              marineLifeDescription: null,
              landmarks: null,
              routePoints: null,
            },
          } as unknown as DiveBriefing),
        ]}
        crew={[]}
        locale={DEFAULT_DIVER_LOCALE}
      />,
    );
    // The chip is the block's first child; each site keeps its own word inside
    // the door, which is where the shop's prose about it is.
    const chip = container.firstElementChild?.firstElementChild;
    expect(chip?.textContent).toBe("Best with recent experience");
  });
});
