// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { RecapSite } from "@/db/recap";
import type { DiverMessageKey, DiverTranslator } from "@/i18n/messages";
import { DIVEDAY_BRAND_COLOR } from "@/lib/brand";
import { AFTER_STATE_TEST_IDS, AfterState, type AfterStateProps } from "./AfterState";

/**
 * The rules ADR 20260827-the-divers-thread's decision 4 states about the
 * after-state — not the layout it renders them in, which is the artboard's
 * argument and the visual suite's baseline.
 *
 * Three of them were defects on the page this replaced, and every assertion
 * below is written so one cannot come back:
 *
 * - **The day's facts render once.** `/recap` rendered conditions and sites
 *   twice — a quiet stat row in its first act, then the keepsake card under it
 *   — so a diver read the same two numbers in two typefaces one screen apart.
 * - **One primary at rest.** Review, Google, tip, photos and "bring a buddy"
 *   competed below the fold, three of them at CTA weight.
 * - **Coral is earned and transient.** The greeting is the thread's third and
 *   last accent, and it stops the moment the diver has answered the one thing
 *   the page asks.
 *
 * It renders the real component rather than reading its source, which is what
 * `AfterState` being synchronous and presentational buys: the two routes
 * resolve the data and bind the actions, so there is nothing here that needs a
 * database, a request or a live token.
 */

afterEach(cleanup);

/** Keys, echoed with their params — the words are the bundle's problem, not this test's. */
const t = ((key: DiverMessageKey, params?: Record<string, unknown>) =>
  params ? `${key}(${Object.values(params).join(",")})` : key) as unknown as DiverTranslator;

const noop = () => {};

function props(overrides: Partial<AfterStateProps> = {}): AfterStateProps {
  return {
    t,
    locale: "en-US",
    shop: {
      name: "Blue Mantis Divers",
      slug: "blue-mantis",
      depthUnit: "meters",
      temperatureUnit: "celsius",
      reviewUrl: null,
      brandColor: null,
      brandDisplayFont: null,
    },
    siteMark: "reef",
    trip: {
      title: "Two-Tank — French Reef",
      waterTemperatureC: 27,
      visibilityMeters: 24,
      surfaceConditions: "Calm",
      boatName: "Mantis II",
      crew: ["Keiko Tanaka", "Sal Moretti"],
    },
    when: "Sat, Aug 29",
    diverName: "Yara Halabi",
    // A site is its name here and nothing else — see "what the record may
    // claim" below for why, and for the type assertion that now holds it.
    sites: [{ name: "French Reef" }],
    shoutout: null,
    photos: [],
    maxPhotos: 12,
    visitCount: 3,
    currency: "usd",
    canTip: false,
    tip: null,
    tipPresets: [10, 20, 40],
    ownReview: null,
    params: {},
    nextDeparture: null,
    // Both of these are required, and both were silently absent until the
    // cast below came off: spreading a `Partial` past `as AfterStateProps`
    // let a missing prop compile, so the component was under test with
    // `undefined` where the routes always pass a value.
    diveRecord: null,
    fieldGuide: [],
    observedSpecies: [],
    actions: { submitReview: noop, uploadPhoto: noop, startTip: noop },
    ...overrides,
  };
}

/**
 * **The field guide says what a place may hold, never what this dive held**
 * (issue #1192, D32).
 *
 * The drawer is future-tense and site-scoped by construction, and the framing
 * is the whole safety property. A sighting *is* recorded now (D30, #1190) — and
 * it is a separate field, separately labelled, on a different part of the page,
 * for exactly that reason: the moment the two share a source, a shop's standing
 * claim about a reef starts reading as somebody's report of a day. The cases
 * below pin both directions.
 */
describe("the field guide", () => {
  const guide = (siteName: string, slugs: string[]) => ({
    siteName,
    rows: slugs.map((slug) => ({ id: `${siteName}-${slug}`, catalogSlug: slug })),
  });

  /**
   * **The boundary of D30** (issue #1190): a species is on this card because a
   * crew member wrote it down, never because the reef is known for it.
   *
   * The two lists draw from one catalog and read almost identically, which is
   * exactly why this is pinned rather than left to the reader of the component:
   * a future refactor that resolved the record's line from `fieldGuide` because
   * both are "the species on this page" would be invisible in a diff and would
   * turn every shop's standing claim about a reef into a report of somebody's
   * day.
   */
  it("never puts the guide's species on the record as something seen", () => {
    const { container } = render(
      <AfterState
        {...props({
          fieldGuide: [guide("French Reef", ["arrow-crab", "atlantic-spadefish"])],
          observedSpecies: [],
        })}
      />,
    );
    // The guide is present and full, so this is not passing for want of data.
    const drawer = within(
      container.querySelector("[data-recap-door='field-guide']") as HTMLElement,
    );
    expect(drawer.getByText("marineLife.species.arrow-crab.name")).toBeTruthy();
    // And the record says nothing at all — no line, no empty label.
    expect(container.querySelector("[data-testid='dive-record-seen']")).toBeNull();
    expect(screen.queryByText("recap.seenOnTheDay")).toBeNull();
  });

  it("names what the crew recorded, in the reader's own language", () => {
    const { container } = render(
      <AfterState
        {...props({
          fieldGuide: [guide("French Reef", ["arrow-crab"])],
          observedSpecies: ["green-sea-turtle"],
        })}
      />,
    );
    const seen = within(container.querySelector("[data-testid='dive-record-seen']") as HTMLElement);
    // A bundle key, per this file's convention: the point is that the sighting
    // is resolved through the same `marineLife.*` copy the guide uses, so it
    // arrives in the diver's language whatever the crew was reading.
    expect(seen.getByText("marineLife.species.green-sea-turtle.name")).toBeTruthy();
    // And it is not the species the guide lists, which is the other half of
    // the same claim.
    expect(seen.queryByText("marineLife.species.arrow-crab.name")).toBeNull();
  });

  it("drops a slug the catalog no longer carries rather than printing it raw", () => {
    const { container } = render(
      <AfterState {...props({ observedSpecies: ["a-species-diveday-retired"] })} />,
    );
    expect(container.querySelector("[data-testid='dive-record-seen']")).toBeNull();
  });

  it("names each site above its own faces, so the list is about a place", () => {
    const { container } = render(
      <AfterState
        {...props({
          fieldGuide: [
            guide("French Reef", ["arrow-crab"]),
            guide("Molasses Reef", ["atlantic-spadefish", "azure-vase-sponge"]),
          ],
        })}
      />,
    );
    // Scoped to the drawer: "French Reef" is also the day's site on the record
    // above, and finding it there would prove nothing about this list.
    const drawer = within(
      container.querySelector("[data-recap-door='field-guide']") as HTMLElement,
    );
    expect(drawer.getByText("French Reef")).toBeTruthy();
    expect(drawer.getByText("Molasses Reef")).toBeTruthy();
    // Keys, per this file's convention — the words are the bundle's problem.
    expect(drawer.getByText("marineLife.species.arrow-crab.name")).toBeTruthy();
    expect(drawer.getByText("marineLife.species.atlantic-spadefish.name")).toBeTruthy();
    expect(drawer.getByText("marineLife.species.azure-vase-sponge.name")).toBeTruthy();
  });

  /**
   * The summary is what most readers see, because the drawer is shut on
   * arrival — so the framing has to survive in the heading alone, and the count
   * is what keeps "this site"/"these sites" honest.
   */
  it("is shut on arrival and scoped to the sites in its own heading", () => {
    const { container } = render(
      <AfterState {...props({ fieldGuide: [guide("French Reef", ["arrow-crab"])] })} />,
    );
    const drawer = container.querySelector("[data-recap-door='field-guide'] details");
    expect(drawer).toBeTruthy();
    expect((drawer as HTMLDetailsElement).open).toBe(false);
    // One site, so the plural argument must say so. The words are the bundle's;
    // what this pins is that the count reaches it.
    expect(screen.getByText("recap.fieldGuideTitle(1)")).toBeTruthy();
  });

  it("renders no drawer when every species a site names has left the catalog", () => {
    const { container } = render(
      <AfterState {...props({ fieldGuide: [guide("French Reef", ["gone", "also-gone"])] })} />,
    );
    expect(container.querySelector("[data-recap-door='field-guide']")).toBeNull();
  });

  it("drops a site whose whole guide has left the catalog, keeping the rest", () => {
    const { container } = render(
      <AfterState
        {...props({
          fieldGuide: [guide("French Reef", ["gone"]), guide("Molasses Reef", ["arrow-crab"])],
        })}
      />,
    );
    const drawer = within(
      container.querySelector("[data-recap-door='field-guide']") as HTMLElement,
    );
    expect(drawer.getByText("Molasses Reef")).toBeTruthy();
    expect(drawer.queryByText("French Reef")).toBeNull();
    // One site left, so the heading's count must say so rather than counting
    // the group that rendered nothing.
    expect(screen.getByText("recap.fieldGuideTitle(1)")).toBeTruthy();
  });

  it("renders no drawer at all when no site the day dived names a species", () => {
    const { container } = render(<AfterState {...props({ fieldGuide: [] })} />);
    expect(container.querySelector("[data-recap-door='field-guide']")).toBeNull();
  });

  /**
   * A row naming a species the catalog has since dropped is skipped rather
   * than rendered as a blank card — `fieldGuideCards`' own rule, asserted here
   * because this surface is where a shop's reader would meet the gap.
   */
  it("drops a species the catalog no longer carries", () => {
    render(
      <AfterState
        {...props({ fieldGuide: [guide("French Reef", ["arrow-crab", "not-a-real-species"])] })}
      />,
    );
    expect(screen.getByText("marineLife.species.arrow-crab.name")).toBeTruthy();
    expect(screen.queryByText(/not-a-real-species/)).toBeNull();
  });
});

/**
 * Every element carrying the primary fill — the page's loudest control.
 *
 * Whole-token matching, not a substring: `bg-primary-tint` is the quiet visit
 * chip and the tip picker's checked state, neither of which is a primary.
 */
function primaries(container: HTMLElement): Element[] {
  return [...container.querySelectorAll("[class]")].filter((node) =>
    node.className.toString().split(/\s+/).includes("bg-primary"),
  );
}

describe("the day's facts render once", () => {
  it("carries exactly one conditions element and one sites element", () => {
    render(<AfterState {...props()} />);
    expect(screen.getAllByTestId(AFTER_STATE_TEST_IDS.conditions)).toHaveLength(1);
    expect(screen.getAllByTestId(AFTER_STATE_TEST_IDS.sites)).toHaveLength(1);
  });

  it("renders no fact line for a fact nobody recorded", () => {
    // `trip_dives` may be empty, a self-guided departure has no crew, a shore
    // dive has no boat, and a trip nobody logged conditions for has none. A
    // keepsake with few facts is short; it never invents a row to fill space.
    render(
      <AfterState
        {...props({
          sites: [],
          trip: {
            title: "Shore dive — Dry Rocks",
            waterTemperatureC: null,
            visibilityMeters: null,
            surfaceConditions: null,
            boatName: null,
            crew: [],
          },
        })}
      />,
    );
    expect(screen.queryByTestId(AFTER_STATE_TEST_IDS.conditions)).toBeNull();
    expect(screen.queryByTestId(AFTER_STATE_TEST_IDS.sites)).toBeNull();
    // The floor still renders: this is a record of a day, however thin.
    expect(screen.getByTestId(AFTER_STATE_TEST_IDS.record)).toBeInTheDocument();
    expect(screen.getByText("Yara Halabi")).toBeInTheDocument();
  });
});

/**
 * **What the record may claim** — the rules a review added on 2026-08-28,
 * after the print pass turned this card into a one-page logbook entry with a
 * ruled Notes block and a **Divemaster** signature rule.
 *
 * That framing is the reason these are not style preferences. Logged dive
 * counts and depths are what divers present for course prerequisites (Rescue,
 * Divemaster, Master Scuba Diver at 50 dives), and a divemaster handed this
 * page to sign is being asked to attest to whatever is printed on it. DiveDay
 * records nothing about dives *performed*, so the only honest page is one that
 * prints what the shop wrote down and leaves the rest as ruled blanks.
 */
/**
 * A compile-time half of the rule below: `RecapSite` carries the site's name
 * and nothing else, so a widened projection is a `pnpm typecheck` failure
 * here, beside the paragraph saying why, rather than a depth quietly reaching
 * a page a divemaster is asked to sign (issue #1120).
 */
type AssertNever<T extends never> = T;
type _RecapSiteCarriesOnlyItsName = AssertNever<Exclude<keyof RecapSite, "name">>;

describe("what the record may claim", () => {
  it("counts no dives — DiveDay has no record of dives performed", () => {
    // It printed `max(trips.planned_dives, sites.length)` as "{n} dives
    // logged": a number a shop typed on the trip row weeks earlier, so a diver
    // who sat out the second tank with an ear squeeze read "2 dives logged".
    // The key is gone from both bundles; this holds the surface to it.
    const { container } = render(<AfterState {...props()} />);
    expect(container.textContent).not.toContain("diveCountSummary");
  });

  it("claims nothing was verified — only who recorded it", () => {
    render(<AfterState {...props()} />);
    expect(screen.queryByText(/verifiedRecord/)).toBeNull();
    expect(screen.getByText("recap.recordedBy(Blue Mantis Divers)")).toBeInTheDocument();
  });

  it("names the sites and has nothing else about them to print", () => {
    // `dive_sites.max_depth_meters` is the *site's* deepest point — the
    // glossary says it "exists solely to be comparable to a certification's
    // depth ceiling" — and when it was null the label fell back to
    // `depth_range`, free-text briefing prose, so "Max depth: 40–60 ft, sandy
    // patches" could print under a max-depth label. Neither is this diver's
    // dive.
    //
    // Both used to sit in `props()` so this test could watch them not render.
    // They are gone from `RecapSite` itself as of issue #1120, which is the
    // stronger guarantee: the surface cannot print a depth it is not handed,
    // and `_RecapSiteCarriesOnlyItsName` above fails `pnpm typecheck` the
    // moment the projection grows a second field. What is left here is the
    // half a type cannot state — that the sites *are* named.
    render(<AfterState {...props()} />);
    const sites = screen.getByTestId(AFTER_STATE_TEST_IDS.sites);
    expect(sites.textContent).toContain("French Reef");
    expect(sites.textContent).not.toContain("maxDepthLabel");
  });

  it("still gives the printer its ruled blanks to write the dive up on", () => {
    // The numbers are the diver's to write and the signing divemaster's to
    // countersign. Deleting the claims without leaving the blanks would have
    // taken the keepsake down with them.
    render(<AfterState {...props()} />);
    expect(screen.getByTestId(AFTER_STATE_TEST_IDS.printNotes)).toBeInTheDocument();
    expect(screen.getByTestId(AFTER_STATE_TEST_IDS.printSignature)).toBeInTheDocument();
  });
});

describe("one primary at rest", () => {
  it("gives the review the only primary weight on the page", () => {
    const { container } = render(<AfterState {...props({ canTip: true })} />);
    const loud = primaries(container);
    expect(loud).toHaveLength(1);
    expect(loud[0]?.textContent).toBe("reviews.submit");
  });

  it("demotes the review submit only once the Google door lights up", () => {
    // The carry-it-to-Google door appears exactly when a strong rating has
    // just landed — never beside the form — and while it is lit the form's own
    // submit steps back, so the page still points at one next action.
    const { container } = render(
      <AfterState
        {...props({
          shop: {
            name: "Blue Mantis Divers",
            slug: "blue-mantis",
            depthUnit: "meters",
            temperatureUnit: "celsius",
            reviewUrl: "https://g.page/r/blue-mantis/review",
            brandColor: null,
            brandDisplayFont: null,
          },
          ownReview: { rating: 5, comment: "Vis was unreal." },
          params: { review: "published" },
        })}
      />,
    );
    const loud = primaries(container);
    expect(loud).toHaveLength(1);
    expect(loud[0]?.textContent).toBe("recap.externalReviewCta");
  });

  it("keeps the Google door shut when nothing was just submitted", () => {
    render(
      <AfterState
        {...props({
          shop: {
            name: "Blue Mantis Divers",
            slug: "blue-mantis",
            depthUnit: "meters",
            temperatureUnit: "celsius",
            reviewUrl: "https://g.page/r/blue-mantis/review",
            brandColor: null,
            brandDisplayFont: null,
          },
          ownReview: { rating: 5, comment: "Vis was unreal." },
        })}
      />,
    );
    expect(screen.queryByText("recap.externalReviewCta")).toBeNull();
  });
});

describe("the coral budget", () => {
  it("spends the thread's last accent on the greeting, once", () => {
    const { container } = render(<AfterState {...props()} />);
    expect(container.querySelectorAll("[class*='accent']")).toHaveLength(1);
  });

  it("renders the greeting quiet once the diver's review is in", () => {
    // Every moment is earned and transient (ADR
    // 20260827-clearwater-surface-language, decision 11). Once the one thing
    // the page asks has been answered, the same words are a page title.
    const { container } = render(
      <AfterState {...props({ ownReview: { rating: 4, comment: null } })} />,
    );
    expect(container.querySelectorAll("[class*='accent']")).toHaveLength(0);
    expect(container.querySelector(".rise-in")).toBeNull();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
      "thread.afterGreeting(Yara)",
    );
  });
});

describe("the milestone stamp", () => {
  it("stamps a milestone visit instead of the plain ordinal line", () => {
    render(<AfterState {...props({ visitCount: 10 })} />);
    expect(screen.getByTestId(AFTER_STATE_TEST_IDS.stamp)).toBeInTheDocument();
    expect(screen.queryByTestId(AFTER_STATE_TEST_IDS.visitLine)).toBeNull();
  });

  it("leaves an ordinary visit its plain line and no stamp", () => {
    render(<AfterState {...props({ visitCount: 12 })} />);
    expect(screen.queryByTestId(AFTER_STATE_TEST_IDS.stamp)).toBeNull();
    expect(screen.getByTestId(AFTER_STATE_TEST_IDS.visitLine)).toBeInTheDocument();
  });

  it("says in words what the roundel draws", () => {
    // Colour and shape never carry a state alone: the whole label is the
    // `<svg>`'s accessible name, however its lines are broken up inside.
    render(<AfterState {...props({ visitCount: 1 })} />);
    expect(screen.getByRole("img", { name: "recap.milestoneStampFirst" })).toBeInTheDocument();
  });
});

describe("the keepsake prints like a logbook page", () => {
  it("carries a ruled notes block and a signature rule, print-only", () => {
    render(<AfterState {...props()} />);
    for (const id of [AFTER_STATE_TEST_IDS.printNotes, AFTER_STATE_TEST_IDS.printSignature]) {
      const block = screen.getByTestId(id);
      // `hidden` on screen, `print:block` on paper — the two halves of "this
      // exists for the printer and nowhere else".
      expect(block.className).toContain("hidden");
      expect(block.className).toContain("print:block");
    }
  });

  it("hides everything except the dive record when printing", () => {
    const { container } = render(
      <AfterState {...props({ shoutout: "Come back for the wreck." })} />,
    );
    const record = screen.getByTestId(AFTER_STATE_TEST_IDS.record);
    for (const child of [...(container.querySelector("main")?.children ?? [])]) {
      if (child === record) {
        expect(child.className).not.toContain("print:hidden");
      } else {
        expect(child.className).toContain("print:hidden");
      }
    }
  });
});

describe("the doors stay quiet", () => {
  it("renders no tip door for a shop that cannot take one and has none to report", () => {
    render(<AfterState {...props({ canTip: false, tip: null })} />);
    expect(screen.queryByText("recap.tipCrew")).toBeNull();
  });

  it("still reports a paid tip after the shop disconnects Stripe", () => {
    // `canTip` alone would hide the diver's own paid confirmation along with
    // the form that started it.
    render(
      <AfterState
        {...props({ canTip: false, tip: { status: "paid", amountCents: 2000, checkoutUrl: null } })}
      />,
    );
    expect(screen.getByText("recap.tipCrew")).toBeInTheDocument();
  });
});

describe("the postcard (ADR 20260901-diveday-reimagined, slice 13i)", () => {
  it("wears the shop's brand when the shop has one, and DiveDay's own when not", () => {
    const { container, unmount } = render(
      <AfterState
        {...props({
          shop: {
            ...props().shop,
            brandColor: DIVEDAY_BRAND_COLOR,
            brandDisplayFont: "bricolage_grotesque",
          },
        })}
      />,
    );
    const style = container.querySelector("[data-brand-style]");
    expect(style?.textContent).toContain("--primary:");
    expect(style?.textContent).toContain("--brand-display:");
    unmount();
    const plain = render(<AfterState {...props()} />);
    expect(plain.container.querySelector("[data-brand-style]")).toBeNull();
  });

  it("draws the day's site on the record's face, decorative and off the printed page", () => {
    const { container } = render(<AfterState {...props({ siteMark: "wreck" })} />);
    const face = screen.getByTestId(AFTER_STATE_TEST_IDS.face);
    const mark = face.querySelector("[data-site-mark]");
    expect(mark?.getAttribute("data-site-mark")).toBe("wreck");
    expect(mark?.getAttribute("aria-hidden")).toBe("true");
    expect(mark?.className).toContain("print:hidden");
    // One drawing on the page, and it sits on the shell so it keeps an edge
    // against the band that is the wash.
    expect(container.querySelectorAll("[data-site-mark]")).toHaveLength(1);
    expect(mark?.className).toContain("bg-surface");
    // The heading is still the heading — the face restyles it, never adds a
    // second one, and the day's facts below it still render once.
    expect(screen.getByRole("heading", { level: 2, name: "recap.logbookHeading" })).toBeTruthy();
    expect(screen.getAllByTestId(AFTER_STATE_TEST_IDS.sites)).toHaveLength(1);
  });
});
