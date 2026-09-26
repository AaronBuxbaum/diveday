// @vitest-environment jsdom
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  GroupLabel,
  InsetGroup,
  LedgerGroup,
  LedgerRow,
  ledgerKindColumnClass,
  ledgerRowBoxClass,
  ledgerRowOpenBoxClass,
  RowKind,
} from "./ledger";

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
 * The class tokens a `className={…}` expression can produce, read from the
 * string and template literals in it with every `${…}` left out:
 * `` `py-3 ${rowClassName}`.trim() `` reads as `py-3`.
 */
function classLiterals(expression: string): string {
  return [...expression.matchAll(/"([^"]*)"|'([^']*)'|`([^`]*)`/g)]
    .map((match) => (match[1] ?? match[2] ?? match[3] ?? "").replace(/\$\{[^}]*\}/g, " "))
    .join(" ");
}

/**
 * The attributes of every `<LedgerRow …>` opening tag in a source file, with
 * whatever sits inside braces left out — so a `className` on a button in the
 * row's `trailing` slot is not read as the row's own — except the row's own
 * `className={…}`, whose literals are kept as a `className="…"` attribute.
 * Found by walking brace depth rather than by a regex, because an attribute
 * value may be a ternary, a template string or a whole element.
 */
function ledgerRowTags(source: string): string[] {
  return openingTags(source, "LedgerRow").map((tag) => tag.own);
}

/**
 * Every `<Name …>` opening tag in a source file: its own attributes, read as
 * `ledgerRowTags` reads a row's, and the index just past its closing `>`.
 */
function openingTags(source: string, name: string): { own: string; end: number }[] {
  const tags: { own: string; end: number }[] = [];
  for (const opening of source.matchAll(new RegExp(`<${name}(?=[\\s>/])`, "g"))) {
    let depth = 0;
    let own = "";
    let expression: string | null = null;
    let cursor = opening.index ?? 0;
    for (; cursor < source.length; cursor++) {
      const char = source[cursor];
      if (char === "{") {
        if (depth === 0 && own.endsWith("className=")) expression = "";
        else if (expression !== null) expression += char;
        depth++;
      } else if (char === "}") {
        depth--;
        if (depth === 0 && expression !== null) {
          own += `"${classLiterals(expression)}"`;
          expression = null;
        } else if (expression !== null) expression += char;
      } else if (expression !== null) expression += char;
      else if (depth === 0 && char === ">" && source[cursor - 1] !== "=") break;
      else if (depth === 0) own += char;
    }
    tags.push({ own, end: cursor + 1 });
  }
  return tags;
}

/**
 * The first element a `<LedgerGroup>` that does not fold opens onto, as the
 * name and the class literals of its opening tag: JSX comments and whitespace
 * before it are skipped, and a group whose first child is an expression
 * (`{rows.map(…)}`) reports nothing.
 */
function listsOpeningAGroup(source: string): { tag: string; className: string }[] {
  return openingTags(source, "LedgerGroup")
    .filter(({ own }) => !/\sfolded\b/.test(own) && !own.trimEnd().endsWith("/"))
    .flatMap(({ end }) => {
      const rest = source.slice(end).replace(/^(?:\s|\{\/\*[\s\S]*?\*\/\})*/, "");
      const child = rest.match(/^<([A-Za-z][\w.]*)/);
      if (!child) return [];
      const [tag] = openingTags(rest, child[1]);
      return [{ tag: child[1], className: tag?.own.match(/className="([^"]*)"/)?.[1] ?? "" }];
    });
}

/**
 * The element each `<LedgerRow>` opens onto — its first child, past comments
 * and whitespace — as the class literals of its opening tag, beside the row's
 * own attributes. A child the file names once and hands over as a variable
 * (`{body}`, Today's station rows) is read where the same file declares it
 * (`const body = (<p …>`).
 */
function ledgerRowContents(source: string): { row: string; className: string }[] {
  return openingTags(source, "LedgerRow")
    .filter(({ own }) => !own.trimEnd().endsWith("/"))
    .flatMap(({ own, end }) => {
      const rest = source.slice(end).replace(/^(?:\s|\{\/\*[\s\S]*?\*\/\})*/, "");
      const named = rest.match(/^\{\s*([A-Za-z_$][\w$]*)\s*\}/);
      const declared = named
        ? source.slice(
            Math.max(0, source.search(new RegExp(`const ${named[1]}\\s*=\\s*\\(?\\s*<`))),
          )
        : null;
      const from =
        named && declared !== null
          ? /^const /.test(declared)
            ? declared.replace(/^[^<]*/, "")
            : ""
          : rest;
      const child = from.match(/^<([A-Za-z][\w.]*)/);
      if (!child) return [];
      const [tag] = openingTags(from, child[1]);
      return [{ row: own, className: tag?.own.match(/className="([^"]*)"/)?.[1] ?? "" }];
    });
}

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

  /**
   * **A horizon and a door are one door** (pixel-craft class 12). Tomorrow's
   * summary drew the 12px disclosure caret, 4×8px of ink, and the door row
   * under it the 16px chevron, 6×10px, ending 3px further in: two arrows at
   * two sizes on two right edges, under a comment saying they read as the
   * same door. The summary draws the door's glyph, turned when open.
   */
  it("draws a horizon row's arrow as the door's chevron, turned when open", () => {
    const { container } = render(
      <>
        <LedgerGroup label="Tomorrow" folded summaryVariant="row">
          <p>a row</p>
        </LedgerGroup>
        <LedgerRow as="div" href="/shop/blue-mantis/trips/1" linkLabel="Open the trip">
          Reef Dive
        </LedgerRow>
      </>,
    );
    const horizon = container.querySelector("summary svg");
    const door = container.querySelector("div > svg");
    expect(horizon).not.toBeNull();
    expect(door).not.toBeNull();
    for (const attribute of ["viewBox", "stroke-width"]) {
      expect(horizon?.getAttribute(attribute), attribute).toBe(door?.getAttribute(attribute));
    }
    expect(horizon?.innerHTML).toBe(door?.innerHTML);
    for (const token of ["h-4", "w-auto", "shrink-0", "text-muted"]) {
      expect(horizon, token).toHaveClass(token);
      expect(door, token).toHaveClass(token);
    }
    expect(horizon).toHaveClass("group-open/fold:rotate-90");
  });

  /**
   * **An open horizon's arrow ends where a closed one does** (pixel-craft
   * class 3). Turned a quarter about its box's centre, the cropped chevron's
   * ink lies 13.8 units across where its box is 8.5: 2px past the content edge
   * each closed door ends on, at `h-4`. Open, it steps back those 2px.
   */
  it("keeps an open horizon's arrow on the edge a closed one ends on", () => {
    const { container } = render(
      <LedgerGroup label="Tomorrow" folded={false} summaryVariant="row">
        <p>a row</p>
      </LedgerGroup>,
    );
    const arrow = container.querySelector("summary svg");
    expect(arrow).toHaveClass("group-open/fold:rotate-90", "group-open/fold:-translate-x-0.5");
    // Turned in the same stroke as it steps, or the step jumps.
    expect(arrow).toHaveClass("transition-transform");
  });

  /**
   * **The group owns the gap under its label** (pixel-craft class 12). Its
   * label sat at three distances from its first hairline: 4px in the inbox,
   * whose lists add nothing, and 10px on the booking form and Today's desk,
   * whose lists added `mt-2` and `mt-1.5`; others added `mt-3`. The label now
   * carries `mb-2`, in both of its shapes, and no list under one adds its own.
   */
  it("keeps one 8px gap under its label, with or without meta", () => {
    const { rerender } = render(
      <LedgerGroup label="Unknown senders">
        <ul />
      </LedgerGroup>,
    );
    expect(screen.getByText("Unknown senders")).toHaveClass("mb-2");
    rerender(
      <LedgerGroup label="Thursday" meta="3 departures">
        <ul />
      </LedgerGroup>,
    );
    expect(screen.getByText("Thursday")).toHaveClass("mb-2");
  });

  it("opens onto its list with no margin of the list's own, anywhere in src/", () => {
    const offenders = sourceFiles(SRC_DIR)
      .filter((file) => file.endsWith(".tsx") && !SWEEP_EXEMPT.has(file))
      .flatMap((file) =>
        listsOpeningAGroup(readFileSync(file, "utf8"))
          .filter(({ className }) => /(?:^|\s)(?:\S*:)?-?m[ty]-/.test(className))
          .map(({ tag, className }) => `${relative(SRC_DIR, file)}: <${tag} ${className}>`),
      );
    // Listed, not counted — nothing on screen will name the file.
    expect(offenders).toEqual([]);
  });

  it("reads the first element under a group, past comments, and not a folded one", () => {
    const source = [
      '<LedgerGroup label="A">{/* why */}<ul className="mt-2 divide-y" /></LedgerGroup>',
      '<LedgerGroup label="B" folded><ul className="mt-3" /></LedgerGroup>',
    ].join("\n");
    expect(listsOpeningAGroup(source)).toEqual([{ tag: "ul", className: "mt-2 divide-y" }]);
  });

  it("rings a horizon row's summary inside itself, as a ledger row's door is ringed", () => {
    // The summary is a ledger row's box, rule to rule. The outset ring crossed
    // the hairlines, and inside an embed frame, whose column is 12px from the
    // screen, it ran 1px off both edges (the pixel probe, booking-confirmed-embed).
    const { container } = render(
      <LedgerGroup label="The rest of the briefing" folded summaryVariant="row">
        <p>a row</p>
      </LedgerGroup>,
    );
    const summary = container.querySelector("summary");
    expect(summary).toHaveClass("focus-visible:focus-ring-inset", "-mx-2", "px-2");
    expect(summary?.className).not.toMatch(/outline-/);
  });
});

describe("LedgerRow", () => {
  it("is a hairline row that closes its own group", () => {
    // `last:border-b` rather than a `last` prop: a row must not have to know
    // where it sits in a list to draw the group's bottom edge.
    const { container } = render(<LedgerRow as="div">Grace Mensah</LedgerRow>);
    const row = container.firstElementChild;
    expect(row).toHaveClass("border-t", "border-border", "last:border-b", "min-h-13");
    expect(row?.className).not.toMatch(/rounded|shadow|bg-surface\b/);
  });

  /**
   * **A list decides whether it closes** (pixel-craft class 6). `last:border-b`
   * is right on the page ground and wrong where a rule already follows: inside
   * a card whose edge is the close, or above a block that opens with its own
   * rule — the counter's walk-in door, the public trip's pitch door — where it
   * left two parallel hairlines with nothing between them.
   */
  it("leaves its close to what follows when its list does not close", () => {
    const { container, rerender } = render(
      <LedgerRow as="div" closed={false}>
        Tom Okafor
      </LedgerRow>,
    );
    const row = () => container.firstElementChild as HTMLElement;
    expect(row()).toHaveClass(...ledgerRowOpenBoxClass.split(" "));
    expect(row()).not.toHaveClass("last:border-b");
    rerender(<LedgerRow as="div">Tom Okafor</LedgerRow>);
    expect(row()).toHaveClass("last:border-b");
    // One box, with and without its close.
    expect(ledgerRowBoxClass).toBe(`${ledgerRowOpenBoxClass} last:border-b`);
  });

  it("takes the counter's taller target at size lg", () => {
    const { container } = render(
      <LedgerRow as="div" size="lg">
        Nadia Petrov
      </LedgerRow>,
    );
    expect(container.firstElementChild).toHaveClass("min-h-14");
    expect(container.firstElementChild).not.toHaveClass("min-h-13");
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

  /**
   * **The kind is a column, not a floor** (pixel-craft class 3). It was
   * `min-w-23`, 92px, sized for "Waiver": a longer word grew its own row's
   * gutter and pushed that row's sentence right of every other row's — "Wed
   * 12:30 PM" is about 97px, es-ES's "Contacto de emergencia" far more. The
   * column is a fixed width and a longer word wraps inside it.
   *
   * **92px on a phone, 104px from `sm` up.** A fixed 104px everywhere took
   * 12px from the sentence on a phone: the diver record's waiver line had
   * 70px at 360 and ran 1.4px out of its box, and the inbox's sender address
   * spilled 12px further (the pixel probe, diver-profile-imported and
   * staff-inbox).
   */
  it("sets the kind in a fixed column its word wraps inside, 92px on a phone", () => {
    render(
      <LedgerRow as="div" kind={{ word: "Contacto de emergencia", tone: "warning" }}>
        Priya Sharma
      </LedgerRow>,
    );
    const kind = screen.getByText("Contacto de emergencia");
    expect(kind).toHaveClass(...ledgerKindColumnClass.split(" "));
    expect(ledgerKindColumnClass.split(" ").sort()).toEqual(["sm:w-26", "w-23"]);
    expect(kind.className).not.toMatch(/(^|\s)(sm:)?(min|max)-w-/);
  });

  it("is the only width a hand-set line indents past the kind by", () => {
    // The public trip's surface interval and "seen" lines sit under the
    // sentence column, past an empty kind: they take the column's class, or
    // they stop lining up the day the column moves.
    const offenders = sourceFiles(SRC_DIR)
      .filter((file) => !SWEEP_EXEMPT.has(file))
      .filter((file) => /\bmin-w-23\b/.test(readFileSync(file, "utf8")))
      .map((file) => relative(SRC_DIR, file));
    expect(offenders).toEqual([]);
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

  it("draws a door and a plain row on one box: 8px of room inside, handed back as margin", () => {
    // The pixel probe (2026-09-25) measured a door's hover fill leaving 0px
    // between its edge and the row's first word, across 50 captures: the
    // fill paints the row, and the row had no horizontal padding. `px-2` is the
    // room; `-mx-2` hands the same 8px back, so the words still start on the
    // column the group label above them starts on. A plain row takes the same
    // box, or its rules step 8px wherever it meets a door — in one list (the
    // inbox's unknown senders) or between two on one page (the diver record's
    // status rows over its bookings).
    const { container, rerender } = render(
      <LedgerRow as="div" href="/shop/blue-mantis/orders/1" linkLabel="Open the order">
        Amara Osei
      </LedgerRow>,
    );
    const box = (element: Element | null) =>
      [...(element?.classList ?? [])].filter((token) => /^-?(?:m|p)[xse]-|border/.test(token));
    const door = box(container.firstElementChild);
    expect(container.firstElementChild).toHaveClass(...ledgerRowBoxClass.split(" "));

    rerender(<LedgerRow as="div">Grace Mensah</LedgerRow>);
    expect(box(container.firstElementChild)).toEqual(door);
  });

  it("rings the door with the app's inset ring on the row's own corner, and sets no ring geometry of its own", () => {
    // The overlay link is the row's box, so the global ring's 2px offset drew
    // it 5px outside the fill, across the hairlines and the rows either side.
    // The inset ring is one utility beside the global rule in globals.css; an
    // offset written here (it was `-3px`, in a style attribute) would be a
    // second copy of the ring's width.
    render(
      <LedgerRow as="div" href="/shop/blue-mantis/divers/1" linkLabel="Open Grace Mensah">
        Grace Mensah
      </LedgerRow>,
    );
    const link = screen.getByRole("link", { name: "Open Grace Mensah" });
    expect(link).toHaveClass("focus-visible:focus-ring-inset", "rounded-[inherit]");
    expect(link).not.toHaveAttribute("style");
  });

  /**
   * **The row owns its vertical inset** (pixel-craft class 5). It had none, so
   * any row taller than its 52px floor put its words on its rules: the public
   * trip's three-line dive rows set their cap tops 5px under one rule and their
   * last descender 3px over the next. Callers padded four ways — `py-3` on the
   * row, `py-2` on its content, `py-1` and `py-2` stacked, or nothing. The row
   * now keeps 8px (`md`), or 12px for a record with room to read (`lg`), or
   * none for a row whose one child paints its whole box (the counter's tap).
   */
  it("keeps 8px above and below its words, and 12px or none when asked", () => {
    const { container, rerender } = render(<LedgerRow as="div">Grace Mensah</LedgerRow>);
    const row = () => container.firstElementChild as HTMLElement;
    expect(row()).toHaveClass("py-2");
    rerender(
      <LedgerRow as="div" stacked kind={{ word: "Waiver", tone: "warning" }}>
        Priya Sharma
      </LedgerRow>,
    );
    // The stacked phone reading took `max-sm:py-2` as the only inset any row
    // had; the base inset makes it one.
    expect(row()).toHaveClass("py-2");
    expect(row()).not.toHaveClass("max-sm:py-2");
    rerender(
      <LedgerRow as="div" pad="lg">
        Grace Mensah
      </LedgerRow>,
    );
    expect(row()).toHaveClass("py-3");
    expect(row()).not.toHaveClass("py-2");
    rerender(
      <LedgerRow as="div" pad="xl">
        Grace Mensah
      </LedgerRow>,
    );
    // A public review's 16px, which its loading skeleton draws too.
    expect(row()).toHaveClass("py-4");
    rerender(
      <LedgerRow as="div" pad="none">
        Grace Mensah
      </LedgerRow>,
    );
    expect(row().className).not.toMatch(/(?:^|\s)py-/);
  });

  /**
   * **The row's inset is the only one** (pixel-craft class 5). Once the row
   * owned its 8px, nine rows still opened onto an element carrying the `py-2`
   * (or `py-3`) that had stood in for it, so their inset doubled: every Today
   * station row went from 52 to 55px and a wrapped one grew 16px, the
   * first-run steps from 62 to 78, the dive-site catalog's to 20px a side. The
   * sweep above reads only the row's own tag, so it saw none of them. A row
   * whose one child paints its whole box (`pad="none"`) is that child's to pad.
   */
  it("opens onto content with no vertical padding of its own, anywhere in src/", () => {
    const offenders = sourceFiles(SRC_DIR)
      .filter((file) => file.endsWith(".tsx") && !SWEEP_EXEMPT.has(file))
      .flatMap((file) =>
        ledgerRowContents(readFileSync(file, "utf8"))
          .filter(({ row }) => !/\spad="none"/.test(row))
          .flatMap(({ className }) =>
            className
              .split(/\s+/)
              .filter((token) => /^(?:\S*:)?p[ytb]-/.test(token))
              .map((token) => `${relative(SRC_DIR, file)}: ${token}`),
          ),
      );
    // Listed, not counted — nothing on screen will name the file.
    expect(offenders).toEqual([]);
  });

  it("reads what a row opens onto, past comments, and through a variable the file declares", () => {
    const source = [
      "const body = (",
      '  <p className="min-w-0 py-2 text-base">x</p>',
      ");",
      "<LedgerRow stacked>{body}</LedgerRow>",
      '<LedgerRow pad="none">{/* why */}<div className="py-3">y</div></LedgerRow>',
      "<LedgerRow>{rows.map((r) => r)}</LedgerRow>",
    ].join("\n");
    expect(ledgerRowContents(source)).toEqual([
      { row: expect.stringContaining("stacked"), className: "min-w-0 py-2 text-base" },
      { row: expect.stringContaining('pad="none"'), className: "py-3" },
    ]);
  });

  it("lets a 44px control overhang that inset, so a one-line row stays 52px", () => {
    // 8 + 44 + 8 is 60: without the overhang every row with a Send or an
    // Assign in it would grow by 8px. The control keeps its whole target; the
    // row's padding is the room around the *words*.
    render(
      <LedgerRow as="div" trailing={<button type="button">Send waiver</button>}>
        Priya Sharma
      </LedgerRow>,
    );
    expect(screen.getByRole("button", { name: "Send waiver" }).parentElement).toHaveClass("-my-2");
  });

  /**
   * **A tall row can set its kind and its fix on its first line** (pixel-craft
   * class 1). The inbox's rows are a sender over a message, and the row centred
   * its kind word and its date on the whole block: "Email" sat 23px below
   * "Unknown sender" it named. `first-line` sets the parts on one baseline from
   * `sm` up (below it the row stacks, and centring stays), and pads the row so
   * a one-line row is still centred in its 52px: 16 + 20 + 16.
   */
  it("sets its parts on the first line's baseline when asked, from sm up", () => {
    const { container, rerender } = render(
      <LedgerRow
        as="div"
        align="first-line"
        kind={{ word: "Email", tone: "neutral" }}
        trailing={<span>Sep 25</span>}
      >
        <p>Unknown sender</p>
        <p>Is the Saturday boat still on?</p>
      </LedgerRow>,
    );
    const row = () => container.firstElementChild as HTMLElement;
    expect(row()).toHaveClass("items-center", "sm:items-baseline", "sm:py-4");
    rerender(
      <LedgerRow as="div" kind={{ word: "Email", tone: "neutral" }}>
        Unknown sender
      </LedgerRow>,
    );
    expect(row()).toHaveClass("items-center");
    expect(row().className).not.toMatch(/items-baseline|sm:py-4/);
  });

  /**
   * **A first-line door's arrow sits on that line** (pixel-craft class 1). An
   * svg has no baseline, so on a baseline-aligned row the flex box made one
   * from its bottom edge: the known diver's inbox arrow stood on the name's
   * baseline, its ink 12.6 to 3.4px above it, 2px high of the line's cap
   * centre. The arrow rides in a box that carries a text baseline (a
   * zero-width space), centred on that line's box, whose centre is the cap
   * centre's within a fraction of a pixel.
   */
  it("gives a first-line door's arrow a text baseline to sit on", () => {
    const { container } = render(
      <LedgerRow
        as="div"
        align="first-line"
        href="/shop/blue-mantis/inbox/1"
        linkLabel="Open the message"
        kind={{ word: "Email", tone: "neutral" }}
      >
        <p>Priya Sharma</p>
        <p>Is the Saturday boat still on?</p>
      </LedgerRow>,
    );
    const arrow = container.querySelector("svg") as SVGElement;
    const line = arrow.parentElement as HTMLElement;
    expect(line.parentElement).toBe(container.firstElementChild);
    expect(line).toHaveClass("inline-flex", "items-center", "shrink-0");
    expect(line).toHaveAttribute("aria-hidden", "true");
    // A zero-width space, spelled by code point: a literal one is invisible here.
    expect(line.textContent).toBe(String.fromCodePoint(0x200b));
    expect(arrow).toHaveClass("h-4", "w-auto");
  });

  it("owns its horizontal box: no call site sets a row's horizontal margin or padding", () => {
    // Today's spine and the first-run checklist each spelled `-mx-2 px-2` on
    // their rows by hand, and the week row then took it back from `sm` up
    // with `sm:mx-0 … sm:px-0` — the very row the probe found with its fill
    // flush against "This week". The counter's blocked row passed `px-4
    // sm:px-5`, which outranks the row's own `px-2` by stylesheet order. The
    // room is the component's: any horizontal margin or padding on a
    // `<LedgerRow>`, in a string or a `className={…}` expression, is a second
    // copy of it or a cancellation of it. The same holds for its vertical
    // padding (the test above): a `py-3` on a row races the row's own `py-2`
    // by stylesheet order, where `pad` says which one it is.
    const offenders = sourceFiles(SRC_DIR)
      .filter((file) => file.endsWith(".tsx") && !SWEEP_EXEMPT.has(file))
      .flatMap((file) =>
        ledgerRowTags(readFileSync(file, "utf8")).flatMap((tag) =>
          [...tag.matchAll(/className="([^"]*)"/g)]
            .flatMap((match) => match[1].split(/\s+/))
            .filter((token) => /^(?:\S*:)?-?(?:m[xse]|p[xseytb])-/.test(token))
            .map((token) => `${relative(SRC_DIR, file)}: ${token}`),
        ),
      );
    // Listed, not counted — nothing on screen will name the file.
    expect(offenders).toEqual([]);
  });

  it("reads a row's own className expression and nothing in its slots", () => {
    // The sweep above is only as good as what it reads: a template string on
    // the row is the row's, and a class on a button in `trailing` is not.
    // Built in pieces so no string literal here carries an interpolation.
    const source = [
      "<LedgerRow className={`px-4 ",
      "$",
      "{extra}`}",
      ' trailing={<a className="px-3">x</a>}>y</LedgerRow>',
    ].join("");
    const [tag] = ledgerRowTags(source);
    expect(tag).toMatch(/className="px-4\s*"/);
    expect(tag).not.toContain("px-3");
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
    expect(chevron).toHaveClass("h-4", "w-auto", "shrink-0", "text-muted");
    expect(screen.getByText("$148.00").parentElement?.nextElementSibling).toBe(chevron);
  });

  /**
   * **The chevron ends where the row's words end** (pixel-craft class 2). The
   * 24-unit `chevron-right` drawn in a 16px square left about 5px of empty box
   * right of its ink, so every door's arrow stopped 5px inside the edge the
   * header button, the hairline's column and "0 of 5 done" all end on. The
   * door draws the same stroke from a box cropped to its ink across (the
   * height stays 24 units, so the glyph is the size it was).
   */
  it("draws the door's chevron from a box cropped to its ink across", () => {
    const { container } = render(
      <LedgerRow as="div" href="/shop/blue-mantis/courses/1" linkLabel="Open Discover Scuba">
        Discover Scuba
      </LedgerRow>,
    );
    const chevron = container.querySelector("svg");
    expect(chevron).toHaveAttribute("viewBox", "7.75 0 8.5 24");
    expect(chevron).not.toHaveClass("size-4");
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

  /**
   * **A stacked row's lines sit evenly between its rules** (pixel-craft class
   * 5). Wrapped, the row's `gap-3` became a 12px gap between its lines, and a
   * 44px "Assign" set the height of the first line with the 20px kind word
   * centred in it: the staffing week's "Needs crew" rows put 24px of air over
   * the kind word and 10px under the last line, 7px low. The line gap is 4px,
   * and the fix overhangs the kind's line instead of sizing it — its target
   * stays 44px.
   */
  it("wraps its lines 4px apart", () => {
    render(
      <LedgerRow
        as="div"
        stacked
        kind={{ word: "Needs crew", tone: "warning" }}
        trailing={<button type="button">Assign</button>}
      >
        <p>5:30 AM Dawn Two-Tank</p>
      </LedgerRow>,
    );
    const trailing = screen.getByRole("button", { name: "Assign" }).parentElement as HTMLElement;
    expect(trailing.parentElement).toHaveClass("max-sm:flex-wrap", "max-sm:gap-y-1");
  });

  /**
   * **The fix overhangs the kind's line only by the room there is** (classes
   * 1, 5 and 7). A 12px overhang (`max-sm:-my-3`) let the kind word set the
   * line, but the room above that line is the row's inset (8px at `md`) and
   * the room below it the 4px line gap: the staffing week's "Assign" started
   * 3px above its row's top rule, its ring over the row above, and Today's
   * 48px Send reached 8px into the sentence under it. The overhang is capped at
   * the smaller room and kept even on both sides — uneven, the control's
   * centre leaves the kind word's (by 2px for `-mt-2 -mb-1`) and a bordered
   * control sits on the rule.
   */
  it("overhangs the kind's line by no more than the room above and below it, evenly", () => {
    const px = (token: string | undefined) =>
      token === undefined ? 0 : Number(token.replace(/^.*?-(?=[\d.]+$)/, "")) * 4;
    /** A side's phone value: its own `max-sm:` token, else its axis's, else the base. */
    const phone = (element: HTMLElement, box: "m" | "p", side: "t" | "b", sign: "" | "-") => {
      const tokens = [...element.classList];
      const find = (prefix: string, axis: string) =>
        tokens.find((token) => new RegExp(`^${prefix}${sign}${box}${axis}-[\\d.]+$`).test(token));
      return px(find("max-sm:", side) ?? find("max-sm:", "y") ?? find("", side) ?? find("", "y"));
    };
    for (const pad of ["md", "lg"] as const) {
      render(
        <LedgerRow
          as="div"
          stacked
          pad={pad}
          kind={{ word: "Needs crew", tone: "warning" }}
          trailing={<button type="button">Assign</button>}
        >
          <p>5:30 AM Dawn Two-Tank</p>
        </LedgerRow>,
      );
      const trailing = screen.getByRole("button", { name: "Assign" }).parentElement as HTMLElement;
      const row = trailing.parentElement as HTMLElement;
      const inset = phone(row, "p", "t", "");
      const gap = px([...row.classList].find((token) => /^max-sm:gap-y-[\d.]+$/.test(token)));
      const above = phone(trailing, "m", "t", "-");
      const below = phone(trailing, "m", "b", "-");
      expect(above, pad).toBeGreaterThan(0);
      expect(above, pad).toBeLessThanOrEqual(inset);
      expect(below, pad).toBeLessThanOrEqual(gap);
      expect(above, pad).toBe(below);
      cleanup();
    }
  });

  /**
   * **A control on the kind's line gives back under the last line the room it
   * takes over the kind** (pixel-craft class 5). Overhanging 4px a side, a 44px
   * "Assign" still makes the kind's line 36px, and the 20px kind word centred
   * in it stands 8px lower than it would alone: the staffing week's "Needs
   * crew" rows kept 20px of air over the kind and 10px under the last line, 5px
   * low. The overhang cannot grow (above), so the room is mirrored instead: a
   * row whose fix holds a control takes those 8px again under its last line.
   * Only a control: a fix that is a fact ("3 spots left", a date) sits in the
   * kind's own line and leaves that line 20px, so it takes nothing back.
   */
  it("mirrors under its last line the room a control takes over the kind's line", () => {
    const px = (token: string | undefined) =>
      token === undefined ? 0 : Number(token.replace(/^.*?-(?=[\d.]+$)/, "")) * 4;
    const CONTROL = 44;
    const KIND_LINE = 20;
    for (const [pad, inset] of [
      ["md", 8],
      ["lg", 12],
    ] as const) {
      render(
        <LedgerRow
          as="div"
          stacked
          pad={pad}
          kind={{ word: "Needs crew", tone: "warning" }}
          trailing={<button type="button">Assign</button>}
        >
          <p>5:30 AM Dawn Two-Tank</p>
        </LedgerRow>,
      );
      const fix = screen.getByRole("button", { name: "Assign" }).parentElement as HTMLElement;
      const row = fix.parentElement as HTMLElement;
      expect(fix, pad).toHaveAttribute("data-ledger-fix");
      const overhang = px([...fix.classList].find((token) => /^max-sm:-my-[\d.]+$/.test(token)));
      const over = (CONTROL - 2 * overhang - KIND_LINE) / 2;
      const mirrored = [...row.classList].filter((token) =>
        token.startsWith("max-sm:has-[>[data-ledger-fix]_:is(a,button)]:pb-"),
      );
      expect(mirrored, pad).toHaveLength(1);
      expect(px(mirrored[0]), pad).toBe(inset + over);
      cleanup();
    }
  });

  it("mirrors nothing on a stacked row with no kind, whose fix has a line of its own", () => {
    render(
      <LedgerRow as="div" stacked trailing={<button type="button">Hide</button>}>
        <p>Pickles Reef</p>
      </LedgerRow>,
    );
    const row = screen.getByRole("button", { name: "Hide" }).parentElement
      ?.parentElement as HTMLElement;
    expect([...row.classList].some((token) => token.includes("data-ledger-fix"))).toBe(false);
  });

  it("gives a stacked fix on a line of its own its whole height", () => {
    // Without a kind the fix drops to a line of its own under the content; an
    // overhang there would put a 44px control on the row's bottom rule.
    render(
      <LedgerRow as="div" stacked trailing={<button type="button">Hide</button>}>
        <p>Pickles Reef</p>
      </LedgerRow>,
    );
    const trailing = screen.getByRole("button", { name: "Hide" }).parentElement as HTMLElement;
    expect(trailing).toHaveClass("max-sm:my-0");
    expect(trailing.className).not.toMatch(/max-sm:-my-3/);
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
