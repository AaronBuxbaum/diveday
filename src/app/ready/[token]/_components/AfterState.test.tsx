// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AfterState } from "./AfterState";
import { props } from "./after-state-test-fixtures";
import { AFTER_STATE_TEST_IDS } from "./after-state-test-ids";

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

/**
 * **"Earliest flight"** (issue #1425; lead-in reworded by #1433). One sentence,
 * two spellings — the clock started at the last recorded exit, or at the day's
 * scheduled end — and nothing at all when the record could not say. It informs
 * and gates nothing, so it is a paragraph rather than a status panel. These
 * assertions pin message *keys*, not English, so the reword left them alone.
 */
describe("the fly-safe line", () => {
  it("renders nothing when the record could not say", () => {
    render(<AfterState context={props()} />);
    expect(screen.queryByTestId(AFTER_STATE_TEST_IDS.flySafe)).toBeNull();
  });

  it("stands a section's 40px under the record, as every section on the page does", () => {
    // It was `mt-6`: 24px under the log card where the crew quote, the
    // review, the doors and the next dive are each 40px apart (K-532).
    render(
      <AfterState
        context={props({
          flySafe: { when: "Sunday 10:20 AM", hours: 24, anchor: "last_dive", reason: "one_dive" },
        })}
      />,
    );
    const line = screen.getByTestId(AFTER_STATE_TEST_IDS.flySafe);
    expect(line).toHaveClass("mt-10");
    expect(line).not.toHaveClass("mt-6");
  });

  it("names the instant, the hours, and the shop, worded off the last dive", () => {
    render(
      <AfterState
        context={props({
          flySafe: {
            when: "Sunday 10:20 AM",
            hours: 24,
            anchor: "last_dive",
            reason: "dives_recorded",
          },
        })}
      />,
    );
    expect(screen.getByTestId(AFTER_STATE_TEST_IDS.flySafe).textContent).toBe(
      "recap.flySafeAfterDive(Sunday 10:20 AM,24,Blue Mantis Divers)",
    );
  });

  it("says so when the clock started at the scheduled return instead", () => {
    render(
      <AfterState
        context={props({
          flySafe: {
            when: "Sunday 10:20 AM",
            hours: 18,
            anchor: "scheduled_return",
            reason: "one_dive",
          },
        })}
      />,
    );
    expect(screen.getByTestId(AFTER_STATE_TEST_IDS.flySafe).textContent).toBe(
      "recap.flySafeAfterReturn(Sunday 10:20 AM,18,Blue Mantis Divers)",
    );
  });

  /**
   * Two divers who did the identical thing today read different numbers when
   * one of them dived here yesterday, and a recap of *today* shows the cause
   * nowhere. Standing on the dock comparing phones, the difference has to
   * explain itself or both of them discount it (issue #1439).
   *
   * The planned-dives route is the same problem pointed the other way, and the
   * card cannot answer it either: **this page carries no dive count at all**
   * — `DiveRecord` dropped "{n} dives logged" on 2026-08-28 because it counted
   * the trip row rather than the diver — so someone who made one dive reads
   * the two-dive figure with nothing here to account for it. That route always
   * anchors on the return, because it exists only when the record is short of
   * its plan.
   */
  it("says why when the reason is neither on this page nor in the diver's own day", () => {
    for (const [anchor, reason, key] of [
      ["last_dive", "earlier_day", "recap.flySafeAfterDiveEarlierDay"],
      ["scheduled_return", "earlier_day", "recap.flySafeAfterReturnEarlierDay"],
      ["scheduled_return", "dives_planned", "recap.flySafeAfterReturnDivesPlanned"],
      // The diver was in the water for these, and was told when the day was
      // due to end: nothing to explain.
      ["last_dive", "dives_recorded", "recap.flySafeAfterDive"],
      ["scheduled_return", "dives_recorded", "recap.flySafeAfterReturn"],
      ["last_dive", "one_dive", "recap.flySafeAfterDive"],
    ] as const) {
      cleanup();
      render(
        <AfterState
          context={props({ flySafe: { when: "Sunday 10:20 AM", hours: 24, anchor, reason } })}
        />,
      );
      expect(
        screen.getByTestId(AFTER_STATE_TEST_IDS.flySafe).textContent,
        `${anchor} ${reason}`,
      ).toBe(`${key}(Sunday 10:20 AM,24,Blue Mantis Divers)`);
    }
  });
});

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
        context={props({
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
        context={props({
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
      <AfterState context={props({ observedSpecies: ["a-species-diveday-retired"] })} />,
    );
    expect(container.querySelector("[data-testid='dive-record-seen']")).toBeNull();
  });

  it("names each site above its own faces, so the list is about a place", () => {
    const { container } = render(
      <AfterState
        context={props({
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
      <AfterState context={props({ fieldGuide: [guide("French Reef", ["arrow-crab"])] })} />,
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
      <AfterState context={props({ fieldGuide: [guide("French Reef", ["gone", "also-gone"])] })} />,
    );
    expect(container.querySelector("[data-recap-door='field-guide']")).toBeNull();
  });

  it("drops a site whose whole guide has left the catalog, keeping the rest", () => {
    const { container } = render(
      <AfterState
        context={props({
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
    const { container } = render(<AfterState context={props({ fieldGuide: [] })} />);
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
        context={props({
          fieldGuide: [guide("French Reef", ["arrow-crab", "not-a-real-species"])],
        })}
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
    render(<AfterState context={props()} />);
    expect(screen.getAllByTestId(AFTER_STATE_TEST_IDS.conditions)).toHaveLength(1);
    expect(screen.getAllByTestId(AFTER_STATE_TEST_IDS.sites)).toHaveLength(1);
  });

  it("renders no fact line for a fact nobody recorded", () => {
    // `trip_dives` may be empty, a self-guided departure has no crew, a shore
    // dive has no boat, and a trip nobody logged conditions for has none. A
    // keepsake with few facts is short; it never invents a row to fill space.
    render(
      <AfterState
        context={props({
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

describe("one primary at rest", () => {
  it("gives the review the only primary weight on the page", () => {
    const { container } = render(<AfterState context={props({ canTip: true })} />);
    const loud = primaries(container);
    expect(loud).toHaveLength(1);
    expect(loud[0]?.textContent).toBe("reviews.submit");
  });

  it("demotes the review submit only once the Google door lights up", () => {
    // The carry-it-to-Google door appears exactly when a rating has
    // just landed — never beside the form — and while it is lit the form's own
    // submit steps back, so the page still points at one next action.
    const { container } = render(
      <AfterState
        context={props({
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

  /**
   * **No review gating** (issue #2095). Google's review policy forbids
   * offering the public review link only to divers who rated well, so the door
   * opens after any submitted rating, one star as much as five.
   */
  it.each([1, 2, 3])("opens the Google door after a %i-star rating too", (rating) => {
    render(
      <AfterState
        context={props({
          shop: {
            name: "Blue Mantis Divers",
            slug: "blue-mantis",
            depthUnit: "meters",
            temperatureUnit: "celsius",
            reviewUrl: "https://g.page/r/blue-mantis/review",
            brandColor: null,
            brandDisplayFont: null,
          },
          ownReview: { rating, comment: null },
          params: { review: rating < 3 ? "pending" : "published" },
        })}
      />,
    );
    expect(screen.getByText("recap.externalReviewCta").closest("a")?.getAttribute("href")).toBe(
      "https://g.page/r/blue-mantis/review",
    );
  });

  it("keeps the Google door shut when nothing was just submitted", () => {
    render(
      <AfterState
        context={props({
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
    const { container } = render(<AfterState context={props()} />);
    expect(container.querySelectorAll("[class*='accent']")).toHaveLength(1);
  });

  it("renders the greeting quiet once the diver's review is in", () => {
    // Every moment is earned and transient (ADR
    // 20260827-clearwater-surface-language, decision 11). Once the one thing
    // the page asks has been answered, the same words are a page title.
    const { container } = render(
      <AfterState context={props({ ownReview: { rating: 4, comment: null } })} />,
    );
    expect(container.querySelectorAll("[class*='accent']")).toHaveLength(0);
    expect(container.querySelector(".rise-in")).toBeNull();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
      "thread.afterGreeting(Yara)",
    );
  });
});

describe("a shop that switched reviews off", () => {
  it("asks for no rating", () => {
    render(<AfterState context={props({ canReview: false })} />);
    expect(screen.queryByText("reviews.askHeading")).toBeNull();
    expect(screen.queryByText("reviews.submit")).toBeNull();
  });

  it("asks for one when it is on", () => {
    render(<AfterState context={props()} />);
    expect(screen.getByText("reviews.askHeading")).toBeInTheDocument();
  });
});

/**
 * **The course variant sits before the ask** (issues #1196, #1205). The review
 * is this page's single primary in every variant, and a course session's own
 * paragraph must not displace it.
 */
describe("a course session's recap", () => {
  const course = {
    title: "Advanced Open Water Diver",
    nextStep: null,
    certification: null,
  } as const;

  it("says what the shop recorded, above the one ask", () => {
    const { container } = render(<AfterState context={props({ course })} />);
    const said = container.textContent ?? "";
    expect(said).toContain("recap.course.notYetCertified");
    expect(said.indexOf("recap.course.notYetCertified")).toBeLessThan(
      said.indexOf("reviews.askHeading"),
    );
    expect(primaries(container)).toHaveLength(1);
  });

  it("renders nothing at all on an ordinary charter", () => {
    const { container } = render(<AfterState context={props({ course: null })} />);
    expect(container.textContent).not.toContain("recap.course.");
  });
});

/**
 * **Bring a buddy: the control is the affordance** (2026-09-17 design review).
 *
 * The link used to print in full, mono, under a "Your link" caption — the
 * loudest thing in a block of prose and the one thing nobody reads. It reaches
 * assistive technology as the button's *description* instead, which is a place
 * that does not go stale when the button reports "Link copied" back.
 */
describe("the buddy link", () => {
  const url = "https://diveday.test/s/blue-mantis?buddy=abc123";

  it("never prints the URL as page text", () => {
    const { container } = render(<AfterState context={props({ buddyLinkUrl: url })} />);
    const visible = [...container.querySelectorAll("*")].filter(
      (node) => node.children.length === 0 && !node.className.toString().includes("sr-only"),
    );
    expect(visible.some((node) => node.textContent?.includes(url))).toBe(false);
    expect(screen.getByText("recap.buddyCta")).toBeInTheDocument();
  });

  it("keeps the URL reachable as the control's description, hidden at rest", () => {
    render(<AfterState context={props({ buddyLinkUrl: url })} />);
    const button = screen.getByText("recap.buddyCta");
    const describedBy = button.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    const description = document.getElementById(describedBy as string);
    expect(description?.textContent).toBe(url);
    // Hidden from sight, not from assistive technology — and it is the one
    // element, so the failed state can reveal the very thing the description
    // already carries.
    expect(description?.className).toBe("sr-only");
    // The name is the visible words, so it cannot contradict them when the
    // button reports back (WCAG 2.5.3).
    expect(button.getAttribute("aria-label")).toBeNull();
  });

  it("renders nothing at all without a link to send", () => {
    render(<AfterState context={props({ buddyLinkUrl: null })} />);
    expect(screen.queryByText("recap.buddyCta")).toBeNull();
    expect(screen.queryByText("recap.buddyHeading")).toBeNull();
  });
});

describe("the doors stay quiet", () => {
  it("renders no tip door for a shop that cannot take one and has none to report", () => {
    render(<AfterState context={props({ canTip: false, tip: null })} />);
    expect(screen.queryByText("recap.tipCrew")).toBeNull();
  });

  it("still reports a paid tip after the shop disconnects Stripe", () => {
    // `canTip` alone would hide the diver's own paid confirmation along with
    // the form that started it.
    render(
      <AfterState
        context={props({
          canTip: false,
          tip: { status: "paid", amountCents: 2000, checkoutUrl: null },
        })}
      />,
    );
    expect(screen.getByText("recap.tipCrew")).toBeInTheDocument();
  });
});

/**
 * **The private pulse sits beside the review, never inside it** (D40, issue
 * #1200). A private field inside a public form is a trap: the diver has no way
 * to tell which half of what they typed the shop will publish. The nesting
 * assertion below is the whole of that rule.
 *
 * **And it is shut at rest** (2026-09-17 design review). It stood open at the
 * review's own weight — five chips, a box and a send button under five stars, a
 * box and a send button — so one page asked one question twice and the diver
 * did the triage. It is the first quiet door now, and opens on arrival only
 * when it already holds something.
 */
describe("the private pulse", () => {
  const pulseForm = (container: HTMLElement) =>
    [...container.querySelectorAll("form")].find((form) =>
      form.querySelector('input[name="category"]'),
    );
  const pulseDoor = (container: HTMLElement) =>
    container.querySelector("[data-recap-door='pulse'] details");

  it("is a door, shut, and the first one under the review", () => {
    const { container } = render(<AfterState context={props()} />);
    const door = pulseDoor(container);
    expect(door).toBeTruthy();
    expect(door?.hasAttribute("open")).toBe(false);
    // First of the run: the ask it belongs to is directly above it.
    expect(container.querySelector("[data-recap-door]")?.getAttribute("data-recap-door")).toBe(
      "pulse",
    );
  });

  it("opens on arrival when the diver already said something", () => {
    const { container } = render(
      <AfterState context={props({ ownPulse: { categories: ["boat"], note: null } })} />,
    );
    expect(pulseDoor(container)?.hasAttribute("open")).toBe(true);
  });

  it("opens on arrival to answer a ?pulse= this render has to report", () => {
    const { container } = render(<AfterState context={props({ params: { pulse: "saved" } })} />);
    expect(pulseDoor(container)?.hasAttribute("open")).toBe(true);
  });

  it("stays shut for a ?pulse= it does not recognize", () => {
    // The param is attacker-supplied, so `noticeFromParam` decides whether it
    // is real — and a value that says nothing must open nothing either.
    const { container } = render(
      <AfterState context={props({ params: { pulse: "constructor" } })} />,
    );
    expect(pulseDoor(container)?.hasAttribute("open")).toBe(false);
  });

  it("puts its inputs outside the review's own form", () => {
    const { container } = render(<AfterState context={props()} />);
    const reviewForm = [...container.querySelectorAll("form")].find((form) =>
      form.querySelector('textarea[name="comment"]'),
    );
    expect(reviewForm).toBeTruthy();
    expect(within(reviewForm as HTMLElement).queryByText("recap.pulseGear")).toBeNull();
    expect(reviewForm?.querySelector('input[name="category"]')).toBeNull();
    // And it is really on the page, one form of its own.
    expect(pulseForm(container)).toBeTruthy();
  });

  it("offers all five categories and a note, and no way back until there is one", () => {
    const { container } = render(<AfterState context={props()} />);
    expect(container.querySelectorAll('input[name="category"]')).toHaveLength(5);
    expect(container.querySelector('textarea[name="note"]')).toBeTruthy();
    expect(screen.queryByText("recap.pulseWithdraw")).toBeNull();
  });

  it("opens on what the diver already said, and shows the way back", () => {
    const { container } = render(
      <AfterState context={props({ ownPulse: { categories: ["boat"], note: "No shade." } })} />,
    );
    const boat = container.querySelector<HTMLInputElement>('input[value="boat"]');
    expect(boat?.defaultChecked).toBe(true);
    expect(container.querySelector<HTMLTextAreaElement>('textarea[name="note"]')?.value).toBe(
      "No shade.",
    );
    expect(screen.getByText("recap.pulseWithdraw")).toBeInTheDocument();
  });

  /**
   * `?pulse=` is attacker-supplied like the other three, so an unrecognised
   * value renders nothing rather than walking the prototype.
   */
  it("says nothing for a notice code it does not recognize", () => {
    render(<AfterState context={props({ params: { pulse: "constructor" } })} />);
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("reports the outcome beside the form", () => {
    render(<AfterState context={props({ params: { pulse: "saved" } })} />);
    expect(screen.getByRole("status")).toHaveTextContent("recap.pulseSaved(Blue Mantis Divers)");
  });
});

/**
 * **One next dive, one reason, and nothing when there is no pick** (D35, issue
 * #1195).
 */
describe("the next dive", () => {
  const pick = {
    tripId: "trip-9",
    title: "Two-Tank — Spiegel Grove",
    startsAt: new Date("2026-09-12T12:00:00Z"),
    reason: "crew_named_site" as const,
    reasonSite: "Spiegel Grove",
    levelCovered: null,
    seatsLeft: 4,
  };
  const worded = {
    when: "in 3 days",
    reason: "recap.nextDiveCrewNamedSite(Spiegel Grove)",
    levelCovers: null,
  };

  it("renders one card carrying one reason", () => {
    render(<AfterState context={props({ nextDive: pick, nextDiveWorded: worded })} />);
    expect(screen.getByRole("heading", { name: "recap.nextDiveHeading" })).toBeInTheDocument();
    expect(screen.getByText(worded.reason)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: pick.title })).toHaveAttribute(
      "href",
      "/s/blue-mantis/trips/trip-9",
    );
  });

  it("renders nothing at all when the board has nothing for this diver", () => {
    render(<AfterState context={props({ nextDive: null, nextDiveWorded: null })} />);
    expect(screen.queryByText("recap.nextDiveHeading")).toBeNull();
  });

  it("makes the departure's name a 44px target, not a 21px line of text", () => {
    // The card's one door was a bare inline link, 244.7 x 21 on every recap
    // capture (K-187); `tapTargetLinkClass` gives it the 44px floor.
    render(<AfterState context={props({ nextDive: pick, nextDiveWorded: worded })} />);
    expect(screen.getByRole("link", { name: pick.title })).toHaveClass(
      "inline-flex",
      "min-h-11",
      "items-center",
    );
  });

  /**
   * **The target grows, the name's line does not** (K-187). As a 44px box in
   * the flow, the name's line grew 8px a side: 12px from the name to its date,
   * the same 12 as from the date to the reason, so the title and its date no
   * longer read as a pair. The 16px the target adds is padding its own
   * negative margin gives back, and the name's `<p>` is a flex line, so the
   * margin comes off the line and no strut holds it open. The date sits 8px
   * under the name, the room the target reaches down, so the focus ring (5px
   * outside the box) ends above the date's ink rather than across it.
   */
  it("keeps the name's line its words' height, and its date nearer it than the reason", () => {
    render(<AfterState context={props({ nextDive: pick, nextDiveWorded: worded })} />);
    const link = screen.getByRole("link", { name: pick.title });
    expect(link).toHaveClass("-my-2", "py-2");
    const line = link.parentElement;
    expect(line).toHaveClass("flex", "text-lg");

    const date = screen.getByText(worded.when);
    expect(line?.nextElementSibling).toBe(date);
    expect(date).toHaveClass("mt-2");
    const reason = screen.getByText(worded.reason);
    expect(date.nextElementSibling).toBe(reason);
    expect(reason).toHaveClass("mt-3");
  });

  /**
   * Two "here is what is next" claims one scroll apart, naming two different
   * departures, is the page arguing with itself — so the footer's bare fact
   * stands down whenever the card rendered.
   */
  it("takes the footer's next-departure line off when the card is present", () => {
    const nextDeparture = { title: "Night Reef", when: "tomorrow" };
    const withCard = render(
      <AfterState context={props({ nextDeparture, nextDive: pick, nextDiveWorded: worded })} />,
    );
    expect(withCard.queryByText(/Night Reef/)).toBeNull();
    withCard.unmount();

    render(<AfterState context={props({ nextDeparture })} />);
    expect(screen.getByText(/Night Reef/)).toBeInTheDocument();
  });

  it("carries no score anywhere in what it renders", () => {
    const { container } = render(
      <AfterState context={props({ nextDive: pick, nextDiveWorded: worded })} />,
    );
    expect(container.innerHTML).not.toMatch(/score|confidence|match strength/i);
  });
});

/**
 * **Never a seat they already hold** (fifth-loop ideas, item 37). The held
 * seat stands where the next-dive card would, and the footer's "next on the
 * board" fact stands down so the page names one departure, not two.
 */
describe("a diver already booked on a later boat", () => {
  const held = { date: "Sat, Oct 24", title: "Two-Tank Reef", time: "7:00 AM" };

  it("says the held seat and drops the footer's next-departure fact", () => {
    render(
      <AfterState
        context={props({
          bookedNext: held,
          nextDeparture: { title: "Night dive", when: "Fri, Oct 23" } as never,
        })}
      />,
    );
    expect(screen.getByText("recap.bookedNext(Sat, Oct 24,Two-Tank Reef,7:00 AM)")).toBeTruthy();
    expect(screen.queryByText(/Night dive/)).toBeNull();
  });

  it("says nothing about other seats without one", () => {
    render(<AfterState context={props()} />);
    expect(screen.queryByText(/recap\.bookedNext/)).toBeNull();
  });
});

/**
 * Recap photos switched off on Features (ADR 20261005-optional-shop-features):
 * the page draws no photo door at all, and a shop with the switch on still
 * gets its door.
 */
describe("the photo door", () => {
  it("is drawn while the shop takes recap photos", () => {
    const { container } = render(<AfterState context={props()} />);
    expect(container.querySelector('input[name="photo"]')).not.toBeNull();
  });

  it("is not drawn while recap photos are switched off", () => {
    const { container } = render(<AfterState context={props({ photosOn: false })} />);
    expect(container.querySelector('input[name="photo"]')).toBeNull();
    expect(screen.queryByText("recap.yourPhotos")).toBeNull();
  });
});

/**
 * **"Stop sharing" sits on the diver's own shared photos and nowhere else**
 * (issue #2806): never on a photo another diver shared, and never on one of
 * the diver's own that only they can see.
 */
describe("stopping sharing a photo", () => {
  const photos = [
    { id: "own-shared", imageUrl: "https://img/a.jpg", caption: null, sharedWithBoat: true },
    { id: "own-kept", imageUrl: "https://img/b.jpg", caption: null },
    { id: "from-sam", imageUrl: "https://img/c.jpg", caption: null, sharedBy: "Sam" },
  ];

  it("offers one control, posting the diver's own shared photo", () => {
    const { container } = render(<AfterState context={props({ photos })} />);
    const buttons = screen.getAllByRole("button", { name: "recap.stopSharing" });
    expect(buttons).toHaveLength(1);
    const posted = [...container.querySelectorAll<HTMLInputElement>('input[name="photoId"]')].map(
      (input) => input.value,
    );
    expect(posted).toEqual(["own-shared"]);
  });
});
