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

/** Every non-test `.ts`/`.tsx` under `src/`, so a sweep can be stated as a fact. */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

/**
 * The mechanical half of ADR 20260827-clearwater-surface-language's decision 3
 * ("one ramp, one chip"). Both assertions here are about the *tree*, not about
 * this component's own rendering: a design language only holds if there is one
 * place the spelling lives, and the way that stops being true is a second copy
 * pasted somewhere nobody is looking.
 */
describe("the group label is single-sourced", () => {
  /**
   * Read out of `ledger.tsx` rather than written here, for two reasons: this
   * file then cannot itself be the second copy the scan is hunting for, and a
   * later adjustment to the tracking value moves the whole check with it
   * instead of failing as a stale literal.
   */
  const spelling = readFileSync(LEDGER, "utf8").match(/tracking-\[[\d.]+em\]/)?.[0];

  it("declares the tracking value in ledger.tsx", () => {
    expect(spelling).toBe("tracking-[0.14em]");
  });

  it("is the only file in src/ that spells it", () => {
    // The eyebrow's own `tracking-[0.18em]` is a different thing at a different
    // volume (`ShopPageHeader.EYEBROW_CLASS`) and is deliberately not matched:
    // this scans for the group label's value alone.
    const offenders = sourceFiles(SRC_DIR)
      .filter((file) => file !== LEDGER)
      .filter((file) => readFileSync(file, "utf8").includes(spelling ?? "\0"))
      .map((file) => relative(SRC_DIR, file));
    // Listed, not counted — nothing on screen will name the file.
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
    expect(heading).toHaveClass(
      "text-xs",
      "font-semibold",
      "tracking-[0.14em]",
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
    expect(kind).toHaveClass("text-warning");
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

  it("renders no link at all when the row is not a door", () => {
    // The silence matters: a row that carries its own fix must not also be
    // wrapped in an overlay that swallows the tap.
    render(<LedgerRow as="div">Grace Mensah</LedgerRow>);
    expect(screen.queryByRole("link")).toBeNull();
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
  it("is one hairline shell of divided rows, flat at rest", () => {
    const { container } = render(
      <InsetGroup label="Data & integrations">
        <div>a row</div>
      </InsetGroup>,
    );
    const shell = container.firstElementChild?.lastElementChild;
    expect(shell).toHaveClass("rounded-2xl", "border", "border-border", "bg-surface", "divide-y");
    expect(shell?.className).not.toMatch(/\bshadow(-|$)/);
  });
});
