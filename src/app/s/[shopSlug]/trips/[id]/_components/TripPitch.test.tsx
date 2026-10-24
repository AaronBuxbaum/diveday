// @vitest-environment jsdom
import { cleanup, render, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { PublicCrewMember } from "@/db/trips";
import { DEFAULT_DIVER_LOCALE } from "@/i18n/settings";
import { pitchHasDoor, pitchOpensOnDoor, TripPitch } from "./TripPitch";
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
      difficultyLevel: "advanced",
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
      timeZone="UTC"
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
    // Every species is still on the page — nothing is deleted, it is one tap
    // away — and only three of them are tiles.
    const door = container.querySelector("[data-pitch-door-body]");
    if (!door) throw new Error("expected the pitch to render a door");
    for (const name of CREATURES.slice(3)) {
      expect(within(door as HTMLElement).getByText(name)).toBeInTheDocument();
    }
  });

  it("keeps the three promoted faces inside the door as well, with their prose", () => {
    // A tile is a photo and a name. The card behind the door is the photo, the
    // name, the shop's note and how to spot it — so promoting a species to the
    // grid must not cost it the only place its prose is printed. Pinned
    // because the obvious "show the tiles, then the remainder" reading drops
    // three field notes off the page, which the door's own count used to imply
    // it had done.
    const { container } = fullDay();
    const door = container.querySelector("[data-pitch-door-body]") as HTMLElement | null;
    if (!door) throw new Error("expected the pitch to render a door");
    for (const name of CREATURES.slice(0, 3)) {
      expect(within(door).getByText(name)).toBeInTheDocument();
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
    for (const heading of ["Look for", "The site", "Who you’re diving with"]) {
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

  it("sets the crew line 24px under the beat above it, inside the door", () => {
    // The crew line brings no margin of its own any more (K-233: `/ready`
    // spaces it with the rest of its sections), so the door says it.
    const { container } = fullDay();
    const door = container.querySelector("[data-pitch-door-body]") as HTMLElement | null;
    if (!door) throw new Error("expected the pitch to render a door");
    const crew = within(door).getByText("Who you’re diving with").closest("section");
    expect(crew).toHaveClass("mt-6");
  });

  it("counts the species the door is holding, and says nothing when it holds none", () => {
    const { container } = fullDay();
    // Ten, not "7 more": the number names what the door holds, and it holds
    // the whole field guide.
    expect(container.textContent).toContain(`${CREATURES.length} species`);
    expect(container.textContent).not.toContain("more species");
    cleanup();
    const short = render(
      <TripPitch
        briefings={[briefing({ creatures: CREATURES.slice(0, 2).map(creature) })]}
        crew={[]}
        locale={DEFAULT_DIVER_LOCALE}
        timeZone="UTC"
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
        timeZone="UTC"
      />,
    );
    expect(container.querySelectorAll("details")).toHaveLength(0);
    // Only the fit line is left, which is the whole block.
    expect(container.firstElementChild?.children).toHaveLength(1);
  });

  /**
   * The page sits the conditions line flush under the door, so its rule is the
   * door's close (pixel-craft class 6); it asks the same question this block
   * answers, never a second detector. Open, the door's body keeps 24px above
   * that rule.
   */
  it("says whether it ends in a door, exactly as it renders one", () => {
    const full = [briefing({ creatures: CREATURES.map(creature) })];
    const { container } = render(
      <TripPitch briefings={full} crew={CREW} locale={DEFAULT_DIVER_LOCALE} timeZone="UTC" />,
    );
    expect(pitchHasDoor(full, CREW)).toBe(true);
    expect(container.querySelector("section")?.lastElementChild?.tagName).toBe("DETAILS");
    expect(container.querySelector("[data-pitch-door-body]")).toHaveClass("pb-6");
    cleanup();
    const bare = [briefing({ diveSite: null } as unknown as Partial<DiveBriefing>)];
    expect(pitchHasDoor(bare, [])).toBe(false);
  });

  /**
   * The day's run above may leave its close to this block only when the block
   * opens on its door's rule — not on the fit word's badge or the faces, which
   * the run's closing rule has to sit over (pixel-craft class 6). Asked of the
   * same builders the block renders from, and checked against what it renders.
   */
  it("says whether it opens on its door, exactly as it renders", () => {
    const opensOn = (briefings: DiveBriefing[], crew: readonly PublicCrewMember[]) => {
      const { container } = render(
        <TripPitch
          briefings={briefings}
          crew={crew}
          locale={DEFAULT_DIVER_LOCALE}
          timeZone="UTC"
        />,
      );
      const first = container.querySelector("section")?.firstElementChild?.tagName ?? null;
      cleanup();
      return first;
    };
    const faces = [briefing({ creatures: CREATURES.map(creature) })];
    const crewOnly = [briefing({ diveSite: null } as unknown as Partial<DiveBriefing>)];
    // The fit word's badge, the door alone, and nothing at all.
    expect(opensOn(faces, CREW)).toBe("P");
    expect(opensOn(crewOnly, CREW)).toBe("DETAILS");
    expect(opensOn(crewOnly, [])).toBeNull();
    const cases: [DiveBriefing[], readonly PublicCrewMember[]][] = [
      [faces, CREW],
      [crewOnly, CREW],
      [crewOnly, []],
    ];
    for (const [briefings, crew] of cases) {
      expect(pitchOpensOnDoor(briefings, crew)).toBe(opensOn(briefings, crew) === "DETAILS");
    }
  });

  it("renders nothing at all for a bare course session", () => {
    const { container } = render(
      <TripPitch
        briefings={[briefing({ diveSite: null } as unknown as Partial<DiveBriefing>)]}
        crew={[]}
        locale={DEFAULT_DIVER_LOCALE}
        timeZone="UTC"
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
        timeZone="UTC"
      />,
    );
    // The chip is the block's first child; each site keeps its own word inside
    // the door, which is where the shop's prose about it is.
    const chip = container.firstElementChild?.firstElementChild;
    expect(chip?.textContent).toBe("Best with recent experience");
  });
});

/**
 * Visual review 2026-10-24, B41: the fit word is a plain line, never a chip,
 * and only for a day that asks something of a diver. "Welcoming dive" stood
 * alone over the faces; each site keeps its own word behind the door.
 */
describe("the pitch's fit line", () => {
  it("says a demanding day in plain words, not a badge", () => {
    const { container } = fullDay();
    const line = container.querySelector("section")?.firstElementChild;
    expect(line?.tagName).toBe("P");
    expect(line?.textContent).toBe("Best with recent experience");
    expect(line?.querySelector("span")).toBeNull();
  });

  it("drops the orphan Welcoming dive chip", () => {
    const { container } = render(
      <TripPitch
        briefings={[
          briefing({
            creatures: CREATURES.map(creature),
            diveSite: { ...briefing().diveSite, difficultyLevel: "beginner" },
          } as unknown as Partial<DiveBriefing>),
        ]}
        crew={CREW}
        locale={DEFAULT_DIVER_LOCALE}
        timeZone="UTC"
      />,
    );
    const section = container.querySelector("section");
    expect(section?.firstElementChild?.tagName).toBe("UL");
    expect(section?.firstElementChild?.textContent).not.toContain("Welcoming dive");
  });
});

describe("the log entry behind the door (issue #2430)", () => {
  const faces = [briefing({ creatures: CREATURES.map(creature) })];
  const logEntry = { startsAt: new Date("2026-07-21T18:30:00Z"), isCourse: false };

  it("sits at the end of the door's body, and the block keeps its three children", () => {
    const { container } = render(
      <TripPitch
        briefings={faces}
        crew={CREW}
        locale={DEFAULT_DIVER_LOCALE}
        timeZone="UTC"
        logEntry={logEntry}
      />,
    );
    const door = container.querySelector("[data-pitch-door-body]");
    if (!door) throw new Error("expected the door");
    const preview = within(door as HTMLElement).getByTestId("log-entry-preview");
    expect(preview).toHaveAttribute("aria-hidden", "true");
    expect(within(preview).getByText("French Reef")).toBeInTheDocument();
    expect(
      within(door as HTMLElement).getByText("After you dive, your log entry is waiting for you."),
    ).toBeInTheDocument();
    // Nobody has recorded anything yet: no shop signature on the promise of a card.
    expect(within(preview).queryByText(/Recorded by/)).not.toBeInTheDocument();
    expect(container.firstElementChild?.children).toHaveLength(3);
  });

  it("is the only thing a door holds for a day with nothing else to open", () => {
    const bare = [briefing({ diveSite: null } as unknown as Partial<DiveBriefing>)];
    expect(pitchHasDoor(bare, [])).toBe(false);
    expect(pitchHasDoor(bare, [], true)).toBe(true);
    expect(pitchOpensOnDoor(bare, [], true)).toBe(true);
    const { container } = render(
      <TripPitch
        briefings={bare}
        crew={[]}
        locale={DEFAULT_DIVER_LOCALE}
        timeZone="UTC"
        logEntry={logEntry}
      />,
    );
    expect(
      container.querySelector("[data-pitch-door-body] [data-testid='log-entry-preview']"),
    ).not.toBeNull();
  });

  it("says nothing on a day that has sailed, and a day with no dives has no door", () => {
    const { container } = render(
      <TripPitch briefings={faces} crew={CREW} locale={DEFAULT_DIVER_LOCALE} timeZone="UTC" />,
    );
    expect(container.querySelector("[data-testid='log-entry-preview']")).toBeNull();
    cleanup();
    expect(pitchHasDoor([], [], true)).toBe(false);
  });
});
