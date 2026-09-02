// @vitest-environment jsdom
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { GroupLabel, InsetGroup, LedgerGroup, LedgerRow, RowKind } from "./ledger";

afterEach(cleanup);

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC_DIR = join(HERE, "..", "..");
const LEDGER = join(HERE, "ledger.tsx");

/** Every `.ts`/`.tsx`/`.css` under `src/`, so a sweep can be stated as a fact. */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.(tsx?|css)$/.test(entry.name) ? [full] : [];
  });
}

/**
 * The two files a sweep must not report itself against: `ledger.tsx`, which is
 * where the spelling is supposed to live, and this file, which has to name it
 * once to pin it. Every *other* test file is in scope — a copy pasted into a
 * test is still a second copy, and excluding the whole `.test.*` family (as
 * this sweep first did) leaves a hole exactly where a snapshot of a hand-rolled
 * label would land.
 */
const SWEEP_EXEMPT = new Set([LEDGER, join(HERE, "ledger.test.tsx")]);

/**
 * These are small-caps by design but are not group labels: the public eyebrow,
 * the earned-moment eyebrow, the shop initials, the schedule's calendar header,
 * the print and legal eyebrows, the demo chip, the held-water status, the
 * selected-trip/request context labels, and the offline manifest specimen.
 */
const LABEL_SWEEP_EXEMPT = new Set([
  join(SRC_DIR, "components/ShopIdentityMenu.tsx"),
  join(SRC_DIR, "components/EarnedMoment.tsx"),
  join(SRC_DIR, "components/ShopPageHeader.tsx"),
  join(SRC_DIR, "components/DemoBanner.tsx"),
  join(SRC_DIR, "components/LegalDocument.tsx"),
  join(SRC_DIR, "components/WaterLocker.tsx"),
  join(SRC_DIR, "components/seat-diver/SelectedTripCard.tsx"),
  join(SRC_DIR, "components/seat-diver/BookingRequestCards.tsx"),
  join(SRC_DIR, "components/OfflineManifestView.tsx"),
  join(SRC_DIR, "app/s/[shopSlug]/_components/NextBoatCard.tsx"),
  join(SRC_DIR, "app/s/[shopSlug]/_components/WeekLedger.tsx"),
  join(SRC_DIR, "app/shop/[shopSlug]/schedule/board/_components/ScheduleBuilder.tsx"),
  join(SRC_DIR, "app/shop/[shopSlug]/trips/[id]/print/page.tsx"),
  join(SRC_DIR, "app/shop/[shopSlug]/trips/[id]/prep/ticket/[bookingId]/page.tsx"),
]);

/**
 * Read out of `ledger.tsx` rather than written here, for two reasons: this file
 * then holds the value in exactly one place — the pin below — rather than
 * scattering copies of the thing it is policing, and a later adjustment to the
 * tracking value moves every check in this file with it instead of leaving a
 * stale literal behind.
 */
const spelling = readFileSync(LEDGER, "utf8").match(/tracking-\[[\d.]+em\]/)?.[0];

/**
 * The mechanical half of ADR 20260827-clearwater-surface-language's decision 3
 * ("one ramp, one chip"). Both assertions here are about the *tree*, not about
 * this component's own rendering: a design language only holds if there is one
 * place the spelling lives, and the way that stops being true is a second copy
 * pasted somewhere nobody is looking.
 */
describe("the group label is single-sourced", () => {
  it("declares the tracking value in ledger.tsx", () => {
    expect(spelling).toBe("tracking-[0.14em]");
  });

  it("is the only file in src/ that spells it", () => {
    // The eyebrow's own `tracking-[0.18em]` is a different thing at a different
    // volume (`ShopPageHeader.EYEBROW_CLASS`) and is deliberately not matched:
    // this scans for the group label's value alone.
    //
    // What this can and cannot catch, stated so nobody reads it as more than it
    // is: it catches a *paste* of the group label's class string, which is the
    // realistic drift once `GroupLabel` exists. A second test below catches
    // hand-rolled small-caps group labels while exempting the distinct eyebrow,
    // initials and offline specimen grammars.
    const offenders = sourceFiles(SRC_DIR)
      .filter((file) => !SWEEP_EXEMPT.has(file))
      .filter((file) => readFileSync(file, "utf8").includes(spelling ?? "\0"))
      .map((file) => relative(SRC_DIR, file));
    // Listed, not counted — nothing on screen will name the file.
    expect(offenders).toEqual([]);
  });

  it("routes designed small-caps labels through the shared helper", () => {
    const labelPattern =
      /className="[^"]*(?:\btext-xs\b[^"]*\buppercase\b|\buppercase\b[^"]*\btext-xs\b)[^"]*"/;
    const offenders = sourceFiles(SRC_DIR)
      .filter((file) => !SWEEP_EXEMPT.has(file) && !LABEL_SWEEP_EXEMPT.has(file))
      .filter((file) => labelPattern.test(readFileSync(file, "utf8")))
      .map((file) => relative(SRC_DIR, file));

    expect(offenders).toEqual([]);
  });
});

/**
 * `Badge` is the only pill (same decision). `KindChip` was the second one: a
 * bordered capsule on every queue row, which is a badge marking the expected
 * state rather than the exceptional one. Its replacement is `RowKind` — the
 * word, with the tone in the ink.
 */
describe("KindChip is gone", () => {
  const KIND_CHIP = join(
    SRC_DIR,
    "app",
    "shop",
    "[shopSlug]",
    "_components",
    "today",
    "KindChip.tsx",
  );

  it("has no file left", () => {
    expect(existsSync(KIND_CHIP)).toBe(false);
  });

  it("has no import or reference left anywhere in src/", () => {
    const offenders = sourceFiles(SRC_DIR)
      .filter((file) => file !== join(HERE, "ledger.test.tsx"))
      .filter((file) => readFileSync(file, "utf8").includes("KindChip"))
      .map((file) => relative(SRC_DIR, file));
    expect(offenders).toEqual([]);
  });
});

describe("GroupLabel", () => {
  it("renders the one spelling, at the heading level the caller names", () => {
    render(
      <GroupLabel as="h2" id="run-the-shop">
        Run the shop
      </GroupLabel>,
    );
    const heading = screen.getByRole("heading", { level: 2, name: "Run the shop" });
    // The tracking class comes from `spelling` — read out of `ledger.tsx` — so
    // an adjustment to the value moves this check with it. Written literally,
    // it would be the stale literal the sweep above exists to forbid.
    expect(heading).toHaveClass(
      "text-xs",
      "font-semibold",
      spelling ?? "tracking-missing",
      "text-muted",
      "uppercase",
    );
    // The id stays on the heading itself: it is what a list's
    // `aria-labelledby` points at, and what a `#fragment` scrolls to.
    expect(heading).toHaveAttribute("id", "run-the-shop");
  });

  it("keeps the caller's className on the label, not on a wrapper", () => {
    // `scroll-mt-24` has to sit on the element the fragment targets, and a
    // menu's `px-2` has to indent the words rather than a box that may not
    // exist — so the className never migrates to the meta wrapper.
    const { container } = render(<GroupLabel className="scroll-mt-24">Backups</GroupLabel>);
    expect(container.querySelector("p")).toHaveClass("scroll-mt-24");
  });

  it("sets a group's shared facts beside the label, as tabular figures", () => {
    render(<GroupLabel meta="3 orders · $412.75">Thursday</GroupLabel>);
    expect(screen.getByText("3 orders · $412.75")).toHaveClass("tabular-nums", "text-muted");
  });

  it("wears no pill chrome around that meta", () => {
    // The count pill this replaced (`UrgencyBand`'s bordered capsule) is one of
    // the ad-hoc pills decision 3 retires: a count is quiet text.
    render(<GroupLabel meta="3 items">Right now</GroupLabel>);
    expect(screen.getByText("3 items").className).not.toMatch(/rounded-full|\bborder\b|\bbg-/);
  });
});

describe("LedgerGroup", () => {
  it("is a plain group when it does not fold", () => {
    const { container } = render(
      <LedgerGroup label="Right now">
        <p>a row</p>
      </LedgerGroup>,
    );
    expect(container.querySelector("details")).toBeNull();
  });

  it("folds as a native <details> — the one disclosure spelling", () => {
    // Native, so keyboard and screen-reader behaviour come free and a JS
    // failure still leaves the rows one tap away. Every collapsing group in
    // the app is this; no slice invents a second.
    const { container, rerender } = render(
      <LedgerGroup label="This week" folded>
        <p>a row</p>
      </LedgerGroup>,
    );
    const details = container.querySelector("details");
    expect(details).not.toBeNull();
    expect(details).not.toHaveAttribute("open");
    expect(details?.querySelector("summary")).toContainElement(screen.getByText("This week"));
    // The caret is the shared drawn one, not a second chevron.
    expect(details?.querySelector("summary svg")).not.toBeNull();

    rerender(
      <LedgerGroup label="This week" folded={false}>
        <p>a row</p>
      </LedgerGroup>,
    );
    expect(container.querySelector("details")).toHaveAttribute("open");
  });

  it("gives that summary the 44px control floor", () => {
    // principles.md §2. The summary is the whole control, and its contents are
    // a 12px caret beside 12px type — `px-2 py-1` alone is a ~24px target.
    // 21 other `<summary>` elements in the app already carry `min-h-11`.
    const { container } = render(
      <LedgerGroup label="This week" folded>
        <p>a row</p>
      </LedgerGroup>,
    );
    const summary = container.querySelector("summary");
    expect(summary).toHaveClass("min-h-11", "items-center");
    // Baseline alignment inside a box taller than its words glues the caret and
    // the label to the top of the target.
    expect(summary?.className).not.toMatch(/items-baseline/);
  });

  it("puts nothing but the heading and its meta inside the summary", () => {
    // `<summary>` takes phrasing content optionally intermixed with *heading*
    // content: a heading may sit here, a `<div>` or a `<span>` wrapping one may
    // not. `UrgencyBand` folds with `meta` on every band of the shop home, so
    // the combination this covers is the one that actually renders.
    const { container } = render(
      <LedgerGroup as="h3" label="This week" meta="3 departures" folded>
        <p>a row</p>
      </LedgerGroup>,
    );
    const summary = container.querySelector("summary");
    expect(summary?.querySelector("div")).toBeNull();
    expect(screen.getByRole("heading", { level: 3, name: "This week" }).parentElement).toBe(
      summary,
    );
    expect(summary).toContainElement(screen.getByText("3 departures"));
    expect(screen.getByText("3 departures")).toHaveClass("tabular-nums");
    // Below `sm` the meta drops under the label instead of squeezing it — a
    // long heading beside a count and a badge ran three lines deep on a phone.
    expect(summary).toHaveClass("flex-wrap");
    expect(screen.getByText("3 departures")).toHaveClass("max-sm:basis-full", "max-sm:text-end");
  });
});

describe("LedgerRow", () => {
  it("is a hairline row that closes its own group", () => {
    // `last:border-b` rather than a `last` prop: a row must not have to know
    // where it sits in a list to draw the group's bottom edge.
    const { container } = render(<LedgerRow as="div">Grace Mensah</LedgerRow>);
    const row = container.firstElementChild;
    expect(row).toHaveClass("border-t", "border-border", "last:border-b", "min-h-12");
    expect(row?.className).not.toMatch(/rounded|shadow|bg-surface\b/);
  });

  it("takes the counter's taller target at size lg", () => {
    const { container } = render(
      <LedgerRow as="div" size="lg">
        Nadia Petrov
      </LedgerRow>,
    );
    expect(container.firstElementChild).toHaveClass("min-h-14");
    expect(container.firstElementChild).not.toHaveClass("min-h-12");
  });

  it("names a kind as a word with tone in the ink, never as a pill", () => {
    render(
      <LedgerRow as="div" kind={{ word: "Waiver", tone: "warning" }}>
        Priya Sharma
      </LedgerRow>,
    );
    const kind = screen.getByText("Waiver");
    // `-strong`, not the raw hue: this word does not know what it is mounted
    // on, and raw `text-warning` is 4.37:1 on `bg-surface-sunken` — which a
    // door row's own hover fill supplies. The table is in
    // docs/design/forms-and-controls.md.
    expect(kind).toHaveClass("text-warning-strong");
    expect(kind.className).not.toMatch(/rounded-full|\bborder\b|\bbg-/);
  });

  it("makes the whole row the target when the row is a door", () => {
    render(
      <LedgerRow as="div" href="/shop/blue-mantis/divers/1" linkLabel="Open Grace Mensah">
        Grace Mensah
      </LedgerRow>,
    );
    expect(screen.getByRole("link", { name: "Open Grace Mensah" })).toHaveClass(
      "absolute",
      "inset-0",
    );
  });

  it("draws the door's chevron itself, after the trailing slot", () => {
    // One decision, not one per surface: nine surfaces drew this glyph by
    // hand and five doors carried nothing saying they opened. The chevron is
    // the last visible child, so `trailing` reads as the row's facts and the
    // glyph as the row's edge; the overlay link comes after it in the DOM.
    const { container } = render(
      <LedgerRow
        as="div"
        href="/shop/blue-mantis/orders/1"
        linkLabel="Open the order"
        trailing={<span>$148.00</span>}
      >
        Amara Osei
      </LedgerRow>,
    );
    const row = container.firstElementChild as HTMLElement;
    const children = [...row.children];
    const link = screen.getByRole("link", { name: "Open the order" });
    const chevron = children[children.indexOf(link) - 1];
    expect(chevron?.tagName).toBe("svg");
    expect(chevron).toHaveAttribute("aria-hidden", "true");
    expect(chevron).toHaveClass("size-4", "shrink-0", "text-muted");
    expect(screen.getByText("$148.00").parentElement?.nextElementSibling).toBe(chevron);
  });

  it("draws no chevron on a row that is not a door", () => {
    const { container } = render(
      <LedgerRow as="div" trailing={<span>Send waiver</span>}>
        Priya Sharma
      </LedgerRow>,
    );
    expect(container.querySelector("svg")).toBeNull();
  });

  it("gives the sentence its own line below sm, and one line from sm up", () => {
    // The phone reading the `TodayPhone` artboard draws: the kind and the fix
    // share the first line, the sentence takes the width beneath them. It is a
    // *layout* fact, so the classes are the assertion — jsdom has no viewport
    // to resolve a breakpoint against, and a screenshot would pin pixels
    // instead of the rule.
    const { container } = render(
      <LedgerRow
        as="div"
        stacked
        kind={{ word: "Waiver", tone: "warning" }}
        trailing={<span>Send waiver</span>}
      >
        <p>Priya Sharma hasn’t been sent hers.</p>
      </LedgerRow>,
    );
    const row = container.firstElementChild as HTMLElement;
    expect(row).toHaveClass("max-sm:flex-wrap");
    const sentence = screen.getByText("Priya Sharma hasn’t been sent hers.")
      .parentElement as HTMLElement;
    // Full width on its own line below sm — and every one of these is a
    // `max-sm:` class, so from sm up the row is the row it always was.
    expect(sentence).toHaveClass("max-sm:basis-full", "max-sm:order-3", "flex-1");
    expect(screen.getByText("Send waiver").parentElement).toHaveClass(
      "max-sm:order-2",
      "max-sm:ms-auto",
    );
  });

  it("leads with its content when stacked without a kind", () => {
    // The artboard's first line is *the kind and the fix*. A row that names
    // no kind has nothing for the left of that line, and the first reading of
    // the rule put a lone chevron (or "Schedule · Hide") on a line above the
    // row's own name. So: content and the door's chevron on line one, the
    // trailing slot end-aligned on its own line beneath — every class still a
    // `max-sm:` one.
    render(
      <LedgerRow
        as="div"
        stacked
        href="/shop/blue-mantis/dive-sites/1"
        linkLabel="Christ of the Abyss"
        trailing={<span>Advanced Open Water · Deep</span>}
      >
        <p>Christ of the Abyss</p>
      </LedgerRow>,
    );
    const content = screen.getByText("Christ of the Abyss", { selector: "p" })
      .parentElement as HTMLElement;
    expect(content).toHaveClass("max-sm:order-1", "flex-1");
    expect(content.className).not.toMatch(/basis-full/);
    const trailing = screen.getByText("Advanced Open Water · Deep").parentElement as HTMLElement;
    expect(trailing).toHaveClass(
      "max-sm:order-3",
      "max-sm:basis-full",
      "max-sm:flex",
      "max-sm:justify-end",
    );
    expect(trailing.className).not.toMatch(/ms-auto/);
    expect(content.parentElement?.querySelector("svg")).toHaveClass("max-sm:order-2");
  });

  it("stays one line when a row is not stacked — the default is unchanged", () => {
    const { container } = render(
      <LedgerRow as="div" kind={{ word: "Waiver", tone: "warning" }}>
        <p>Priya Sharma</p>
      </LedgerRow>,
    );
    const row = container.firstElementChild as HTMLElement;
    expect(row).not.toHaveClass("flex-wrap");
    // `border-border` contains the substring "order-", so ask the classes,
    // never the string.
    const ordered = [...row.querySelectorAll("*")].filter((node) =>
      [...node.classList].some((name) => /^(?:max-sm:)?order-/.test(name)),
    );
    expect(ordered).toHaveLength(0);
  });

  it("renders no link at all when the row is not a door", () => {
    // The silence matters: a row that carries its own fix must not also be
    // wrapped in an overlay that swallows the tap.
    render(<LedgerRow as="div">Grace Mensah</LedgerRow>);
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("cannot be a door without a name for it", () => {
    // A stretched overlay link with no children and no `aria-label` is an
    // unnamed link — an axe `link-name` violation on the one control the row's
    // whole text sits behind. The guard is the type, not a runtime default:
    // `href` and `linkLabel` are one union, so this fails `pnpm typecheck`.
    render(
      // @ts-expect-error — `href` without `linkLabel` is not a valid door.
      <LedgerRow as="div" href="/shop/blue-mantis/divers/1">
        Grace Mensah
      </LedgerRow>,
    );
    // ...and the pair, together, still names the link.
    cleanup();
    render(
      <LedgerRow as="div" href="/shop/blue-mantis/divers/1" linkLabel="Open Grace Mensah">
        Grace Mensah
      </LedgerRow>,
    );
    expect(screen.getByRole("link")).toHaveAccessibleName("Open Grace Mensah");
  });
});

describe("RowKind", () => {
  it("carries a tally inside the label, and only a positive one", () => {
    const { rerender } = render(<RowKind word="Waiver" tone="neutral" count={3} />);
    expect(screen.getByText("3")).toHaveClass("tabular-nums");

    rerender(<RowKind word="Waiver" tone="neutral" count={0} />);
    // A kind that turned up cannot also be a "· 0" — it would contradict its
    // own presence.
    expect(screen.queryByText("0")).toBeNull();
  });
});

describe("InsetGroup", () => {
  it("is one hairline shell of divided rows on the panel's bed", () => {
    const { container } = render(
      <InsetGroup label="Data & integrations">
        <div>a row</div>
      </InsetGroup>,
    );
    const shell = container.firstElementChild?.lastElementChild;
    // The same object as a SectionCard and a table shell: Reef's panel radius
    // and the warm bed, never the ad-hoc `shadow-sm` (ADR
    // 20260901-diveday-reimagined, 13a).
    expect(shell).toHaveClass(
      "rounded-panel",
      "border",
      "border-border",
      "bg-surface",
      "shadow-bed",
      "divide-y",
    );
    expect(shell?.className).not.toMatch(/\bshadow-sm\b/);
  });
});
