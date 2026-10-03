import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { declarations, readGlobalsCss, topLevelBlocks } from "@/test/stylesheet";

/**
 * **The order the trip page composes in, pinned as a rule.**
 *
 * ADR 20260827-the-divers-thread, decision 2: "the hero ... the pitch ... who
 * it's for ... then **the form, terminal** — nothing below it but the fine
 * print it already owns." Until 2026-08-28 it ran the other way round: the form
 * sat directly under the hero, and the forecast, the packing list and the dive
 * briefings — roughly a thousand pixels of reading — followed it, which put the
 * page's one act in the middle of its own scroll.
 *
 * This reads the route's source because the thing being pinned is a *server*
 * page's composition: there is no render to inspect without a database, a
 * request and a shop, and an e2e spec that scrolls the real page cannot say
 * *why* a section is where it is. The same shape as
 * `src/i18n/provider-coverage.test.ts`, and for the same reason.
 */

const SOURCE = readFileSync(join(__dirname, "page.tsx"), "utf8");

/**
 * Where a marker first appears in the route's source, or -1.
 *
 * No marker below is a dotted message key: `src/i18n/raw-messages.test.ts`
 * sweeps the whole tree for any one-argument call whose only argument is a
 * dotted key string, and reads one here as a translator formatting a message
 * with no values for its placeholders. Markers name JSX instead.
 */
function positionOf(marker: string): number {
  return SOURCE.indexOf(marker);
}

/**
 * **Every block this page may render between the hero and the form.**
 *
 * The list is the rule (ADR 20260904-reef-all-the-way-down, decision 1): the
 * page is bounded to three field-guide tiles and a door, so a feature that
 * wants to sell harder opens the door rather than adding a section. It measured
 * 5,782px at 390 before the form when nothing bounded it.
 */
const ABOVE_THE_FORM = [
  "<TripHeader",
  "<TripActions",
  "<TripDayPlan",
  "<TripPitch",
  "<ConditionsLine",
  "<TripChangeLedger",
  "<TripAlternatives",
] as const;

/**
 * **One rule between two blocks, never two** (pixel-craft class 6). Each list
 * on this page closes itself unless the page knows the block under it opens on
 * a rule of its own: the day's run over a pitch that opens on its door. The
 * other boats always close theirs, and the requirement note under them draws
 * none: left open over the note's rule, the last boat stood in an 89px band
 * with its words 13px from the rule above and 46px from the one below (K-16
 * review, site-briefing).
 */
describe("the trip page's rules", () => {
  it("leaves the day's run open only over a pitch that opens on its door", () => {
    expect(SOURCE).toMatch(
      /<TripDayPlan[^>]*nextOpensOnRule=\{pitchOpensOnDoor\(diveBriefings, publicCrew\)\}/,
    );
  });

  it("closes the other boats, and rules the requirement note only when it opens the block", () => {
    expect(SOURCE).not.toMatch(/<TripAlternatives[^>]*closed=/);
    expect(positionOf("<TripAlternatives")).toBeLessThan(positionOf("{requirementNote ? ("));
    // Alone, the note stands a section from the block above on the page's
    // stack (K-162) and opens on its own rule; under the boats it sits 16px
    // below their closing rule, inside the one block the two make.
    expect(SOURCE).toMatch(/worthALookRows\.length > 0 \? "mt-4" : "border-t border-border pt-4"/);
  });
});

/**
 * **The two weather warnings, each on its neighbour's inset** (pixel-craft
 * K-351 follow-up). Neither stands beside the booking card. A conditions hold
 * replaces the form with plain type (`ConditionsHoldSection`), and the one box
 * beside its banner is the minimum-seats note directly under it, 16px in: so
 * the banner is the default tone panel, level with that note on a phone.
 * Conditions changed needs a booking, and a booking renders the booked moment
 * on the `lg` rung: so that panel is the `lg` twin.
 */
describe("the trip page's weather warnings", () => {
  function panelAt(marker: string): string {
    const at = positionOf(marker);
    expect(at).toBeGreaterThan(-1);
    return SOURCE.slice(at, SOURCE.indexOf("</", at));
  }

  it("sets the hold banner on the default tone panel, level with the note under it", () => {
    const hold = panelAt("{trip.conditionsHold ? (");
    expect(hold).toMatch(/\$\{TONE_PANEL_CLASS\}/);
    expect(hold).not.toContain("TONE_PANEL_LG_CLASS");
  });

  it("sets the conditions-changed panel on the lg twin, as the booked moment is", () => {
    expect(panelAt("conditionsChangedSinceBooking(")).toMatch(/\$\{TONE_PANEL_LG_CLASS\}/);
  });
});

describe("the trip page's order", () => {
  it("bounds what runs above the form, and bounds its own list", () => {
    // The count is the bound. Adding a section means editing this literal and
    // this number, which is the deliberate act the ADR asks for.
    expect(ABOVE_THE_FORM).toHaveLength(7);
    const positions = ABOVE_THE_FORM.map(positionOf);
    for (const at of positions) expect(at).toBeGreaterThan(-1);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    // Everything the page actually renders in that range, read off the source
    // rather than listed by hand: any capitalised JSX name between the hero and
    // the form's slot that is not on the list above fails here.
    const region = SOURCE.slice(positionOf("<TripHeader"), positionOf("{confirmed ? ("));
    const rendered = new Set([...region.matchAll(/<([A-Z][A-Za-z]*)/g)].map((m) => `<${m[1]}`));
    expect([...rendered].sort()).toEqual([...ABOVE_THE_FORM].sort());
  });

  it("keeps the five moved beats inside the pitch's door", () => {
    // They are `TripPitch`'s children now. One promoted back onto the page is
    // the regression this slice exists to stop — and the way it would arrive is
    // somebody re-adding the element here rather than opening the door.
    for (const beat of [
      "TripRoutes",
      "TripLookFor",
      "TripMoments",
      "TripSiteNotes",
      "TripCrewLine",
    ]) {
      expect(SOURCE).not.toContain(`<${beat}`);
    }
  });

  it("runs pitch, then requirement, then the form, then the contact line", () => {
    const pitch = positionOf("<TripDayPlan");
    const conditions = positionOf("<ConditionsLine");
    const requirement = positionOf("{requirementNote ? (");
    const form = positionOf("<BookSpotSection");
    const contact = positionOf("<ShopContactLinks");

    for (const marker of [pitch, conditions, requirement, form, contact]) {
      expect(marker).toBeGreaterThan(-1);
    }
    // The shop's own words about each site sit with the pitch, above the form —
    // they are what a diver reads to decide, and the whole reason
    // ADR 20260813-dive-site-briefings-are-the-shops-own-words asks a shop to
    // write them. They reached no diver at all between slices 7c and 2026-08-28,
    // and from 16e they are behind `TripPitch`'s door rather than gone.
    expect(pitch).toBeLessThan(conditions);
    expect(conditions).toBeLessThan(requirement);
    expect(requirement).toBeLessThan(form);
    expect(form).toBeLessThan(contact);
  });

  it("renders no forecast, packing or briefing section below the form", () => {
    // The form card is the last *section*. Only the shop's contact line
    // follows it, and every state that stands in the form's place
    // (`TripFullSection`, `TripSailedNotice`, …) shares its slot rather than
    // sitting after it.
    // Named as elements and as imports, not as words: the prose above the
    // composition still explains where packing went, and a rule that trips on
    // its own explanation teaches people to delete the explanation.
    for (const component of ["PackingSection", "DiveBriefingsSection", "ForecastSection"]) {
      expect(SOURCE).not.toContain(`<${component}`);
      expect(SOURCE).not.toContain(`./_components/${component}`);
    }
  });

  it("joins the thread's measure", () => {
    // Every page a booked diver walks reads at `max-w-xl` (decision 1). The
    // trip page was the last `max-w-2xl` on that walk.
    expect(SOURCE).toContain("max-w-xl");
    expect(SOURCE).not.toContain("max-w-2xl");
  });

  /**
   * **The trip stands in the public pages' own frame** (pixel-craft class 3,
   * K-170). It alone was `px-6 py-16`: on a phone its hero, rules and card
   * started at x 24 where the chrome, the footer and every sibling page start
   * at 16, and its eyebrow sat 84px under the chrome's rule against the
   * siblings' 36–44 — the 64px padding plus the header's own `mt-4`.
   */
  it("frames its column as every public page does, with nothing above the header", () => {
    const FRAME = "mx-auto w-full max-w-xl flex-1 px-4 py-8 sm:px-6 sm:py-10";
    const LOADING = readFileSync(join(__dirname, "loading.tsx"), "utf8");
    const HEADER = readFileSync(join(__dirname, "_components", "TripHeader.tsx"), "utf8");
    // Both of this page's non-embed columns — the departure and the cancelled
    // landing — and its loading skeleton.
    expect(SOURCE.split(`: "${FRAME}"`).length - 1).toBe(2);
    expect(LOADING).toContain(`<main className="${FRAME}">`);
    for (const source of [SOURCE, LOADING]) expect(source).not.toContain("py-16");
    // The header opens the column; the staff preview bar keeps its own `mb-6`.
    expect(HEADER).toMatch(/return \(\s*<ShopPageHeader/);
  });

  /**
   * **One rhythm below the hero** (pixel-craft class 4, K-162;
   * forms-and-controls.md: "`space-y-10` between a page's sections, never
   * `mt-*`"). Each section spelled its own top margin — `mt-8` on the day,
   * the pitch, the other boats, the requirement note and the contact line,
   * `mt-6` on the conditions line and the change ledger, `mt-10` on the form
   * card — so the page's sections stood 24, 32 and 40px apart. They share
   * one `space-y-10` now, and none carries a margin of its own.
   */
  it("stacks every section from the day's run to the contact line 40px apart", () => {
    const opening = '<div className="mt-10 space-y-10">';
    const stack = positionOf(opening);
    expect(stack).toBeGreaterThan(-1);
    // The stack opens directly on the day's run, and holds everything to the
    // shop's contact line.
    expect(SOURCE.slice(stack + opening.length, positionOf("<TripDayPlan"))).not.toMatch(
      /<[A-Za-z]/,
    );
    for (const marker of [
      "<TripDayPlan",
      "<TripAlternatives",
      "<BookSpotSection",
      "<ShopContactLinks",
    ]) {
      expect(positionOf(marker)).toBeGreaterThan(stack);
    }
    const region = SOURCE.slice(stack + opening.length, SOURCE.lastIndexOf("</main>"));
    expect(region).toContain("<ShopContactLinks");
    // No section in it spells its own distance from the one above.
    expect(region.match(/className=(?:"|\{`)[^"`]*\bmt-(?:6|8|10|12)\b/g) ?? []).toEqual([]);
    expect(region.match(/<TripChangeLedger[^>]*className=/g) ?? []).toEqual([]);
    // The skeleton stands its bars on the same stack, so nothing moves when
    // the sections land.
    expect(readFileSync(join(__dirname, "loading.tsx"), "utf8")).toContain(opening);
    // Under the pitch's door the conditions line sits flush, its rule the
    // door's close; with no door the two stand a section apart.
    expect(region).toContain(
      '<div className={pitchHasDoor(diveBriefings, publicCrew) ? undefined : "space-y-10"}>',
    );
  });

  it("leaves every section's own component without an outer margin", () => {
    const component = (name: string) =>
      readFileSync(join(__dirname, "_components", `${name}.tsx`), "utf8");
    // The day's run, the pitch and the other boats open on a bare section.
    // Counted rather than matched, so a failure names what it found.
    const found = (name: string, pattern: RegExp) => component(name).match(pattern) ?? [];
    for (const name of ["TripDayPlan", "TripPitch", "TripAlternatives"]) {
      expect(found(name, /<section className="mt-8">/g), name).toEqual([]);
    }
    expect(found("ConditionsLine", /\bmt-6\b/g)).toEqual([]);
    // Every state that stands in the form's slot.
    expect(found("BookingSections", /\bmt-1[02]\b/g)).toEqual([]);
    expect(found("EmbedBookedNotice", /\bmt-10\b/g)).toEqual([]);
  });

  /**
   * **The phone's Book is a bar at the foot, not a pill over the page**
   * (pixel-craft class 9, K-139). A 70×48 pill fixed 16px off the corner of
   * every phone screen sat on the page's own controls at rest — the depth
   * picker's caret, "…on 2 of 3 logged dives", a dive's "water" — and nothing
   * reserved room for it. It is now a full-width bar in the chrome's materials,
   * and the document ends that bar's height lower, so the last of the page and
   * the shop's footer scroll clear of it and a field or fragment lands above it.
   */
  it("pins the phone's Book as a bar the document ends clear of", () => {
    // No control pinned by a corner offset any more: the pill was `fixed`
    // 16px off the screen's bottom corner.
    expect(SOURCE.match(/\bfixed (?:[\w-]+ )*bottom-4\b/g) ?? []).toEqual([]);
    const bar = SOURCE.match(
      /<div\s+data-foot-bar=""\s+className="([^"]*)"\s*>\s*(?:\{\/\*[\s\S]*?\*\/\}\s*)?<a href="#book" className=\{buttonClass\(\{ className: "w-full" \}\)\}>/,
    );
    expect(bar?.[1]).toBe(
      "fixed inset-x-0 bottom-0 z-20 border-t border-border bg-background/95 px-4 py-3 backdrop-blur sm:hidden print:hidden",
    );
    // The bar's height: the md button (3rem), its `py-3` (1.5rem), its hairline.
    const height = "calc(3rem + 1.5rem + 1px)";
    const phone = topLevelBlocks(readGlobalsCss())
      .filter((block) => block.prelude === "@media (width < 40rem)")
      .flatMap((block) => topLevelBlocks(block.body));
    const rule = (selector: string) =>
      declarations(phone.find((candidate) => candidate.prelude === selector)?.body ?? "");
    expect(rule("body:has([data-foot-bar])")["padding-bottom"]).toBe(height);
    expect(rule("html:has([data-foot-bar])")["scroll-padding-bottom"]).toBe(height);
  });

  it("keeps the phone's Book bar a verb pointing at the form", () => {
    // It carried the seat count ("Book · 3 left"), which is the fact the card
    // it scrolls to already states in its own corner.
    expect(SOURCE).toContain("bookVerb");
    expect(SOURCE).not.toContain("bookAndSpotsLeft");
    expect(SOURCE).toContain('href="#book"');
    expect(SOURCE).toContain("{!confirmed && !inPast && !trip.conditionsHold ? (");
  });

  it("suppresses the requirement sentence for a course session", () => {
    // A course states its own admission rule on its own page, and its
    // itinerary's gate is deliberately not a booking gate — repeating the
    // site's demand here would read as a bar on the very students the course
    // exists to create.
    expect(SOURCE).toContain("const combinedRequirement = trip.course\n    ? null");
  });

  it("leaves the departure's unfurl card untouched", () => {
    // A page-level `openGraph` block *replaces* the root layout's rather than
    // merging into it, so a recomposition that quietly drops the spread takes
    // `og:site_name` and `og:type` off every departure's link preview.
    expect(SOURCE).toContain("openGraph: {\n      ...openGraphSite,");
    expect(SOURCE).toContain("alternates: { canonical },");
    expect(SOURCE).toContain("robots: shopSearchListingRobots(shop.searchListingOptOutAt),");
  });

  it("leaves the embed contract exactly where it was", () => {
    // `?embed=1` drops the chrome and the back link, the `confirm` capability
    // is the whole gate on `?booking=`, and no structured data is emitted in
    // the frame (the embed points its canonical at this page).
    expect(SOURCE).toContain('const isEmbed = embed === "1";');
    expect(SOURCE).toContain("const structuredData = isEmbed\n    ? null");
    expect(SOURCE).toContain(
      'isEmbed && bookingToken\n      ? await verifyBookingCapability(db, { token: bookingToken, purpose: "confirm" })',
    );
    expect(SOURCE).toContain("const reviewAggregate = isEmbed ? null :");
  });
});

/**
 * **The door remembers who opened it, and nobody else** (ADR
 * 20260906-before-you-ask, decision 3). A cold request renders the form that
 * ships: the known-diver facts are read only through a verified handoff, the
 * panel renders only off that read, and an email typed into the form never
 * reaches the page's own render. Pinned at the source, like the order above,
 * because what is being pinned is which *inputs* a server page consults.
 */
describe("the known diver's facts", () => {
  const SECTIONS = readFileSync(join(__dirname, "_components", "BookingSections.tsx"), "utf8");

  it("are read only through the handoff, and never on an embed", () => {
    const read = SOURCE.indexOf("readKnownDiver(db, {");
    expect(read).toBeGreaterThan(-1);
    const guard = SOURCE.lastIndexOf("handoffToken && !isEmbed", read);
    expect(guard).toBeGreaterThan(-1);
    // One read, and one guard directly above it.
    expect(SOURCE.split("readKnownDiver(").length - 1).toBe(1);
    expect(read - guard).toBeLessThan(120);
  });

  it("render as a panel only when the read answered", () => {
    expect(SOURCE).toContain("const knownDiverPanel = knownDiver\n    ? {");
    expect(SECTIONS).toContain("{knownDiver ? (\n          <KnownDiverPanel");
  });

  it("never come from an email typed into the form", () => {
    // The cold-email path is an action that returns nothing and a form that
    // hears nothing back — the page consults no search param but the handoff.
    expect(SOURCE).not.toMatch(/readKnownDiver\([^)]*email/);
    expect(SECTIONS).toContain(
      "onLeadEmailSettled={knownDiver || tripRef.embed ? undefined : offerHandoff}",
    );
  });
});
