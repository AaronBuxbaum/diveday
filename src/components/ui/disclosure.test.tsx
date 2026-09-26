// @vitest-environment jsdom
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { cardSummaryClass } from "./card";
import {
  CompactDisclosureRow,
  DangerDisclosure,
  DisclosureRow,
  DisclosureRowList,
  DisclosureRowMessage,
  SummaryCaret,
} from "./disclosure";

const SRC_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

afterEach(cleanup);

describe("DisclosureRow's focus ring", () => {
  /**
   * The row sits flush inside `DisclosureRowList`'s `overflow-hidden` card, so
   * the global ring — 5px outside the summary — was cut on both sides of every
   * row and the top of the first (the pixel probe, public schedule captures).
   */
  it("draws it inside the summary, and rounds it into the card's corners at the ends", () => {
    const { container } = render(
      <DisclosureRowList>
        <DisclosureRow id="a" heading="First">
          body
        </DisclosureRow>
        <DisclosureRow id="b" heading="Last">
          body
        </DisclosureRow>
      </DisclosureRowList>,
    );
    for (const summary of container.querySelectorAll("summary")) {
      expect(summary).toHaveClass(
        "focus-visible:focus-ring-inset",
        "[details:first-child>&]:rounded-t-panel",
        "[details:last-child:not([open])>&]:rounded-b-panel",
      );
    }
  });
});

/**
 * **A caret sits on its summary's first line** — pixel-craft classes 1 and 2.
 * Centred on the block, a caret beside a wrapped title floated between its
 * lines, or level with the chips under it: 12.5px low on the manifest's dock
 * checklist at 390, 21px on "On this phone". Its box is one line tall.
 */
describe("SummaryCaret", () => {
  it("boxes the caret one line tall, centred in that line", () => {
    const { container } = render(<SummaryCaret className="group-open/x:rotate-90" />);
    const box = container.firstElementChild;
    expect(box).toHaveClass("flex", "h-lh", "shrink-0", "items-center");
    const caret = box?.querySelector("svg");
    expect(caret).toBeTruthy();
    expect(caret).toHaveClass("group-open/x:rotate-90");
  });

  it("takes the first line's own height when it is not the summary's line", () => {
    // A larger heading passes its type class, so `1lh` is that heading's line;
    // a first line that is a row of 36px chips passes `h-9`.
    const { container } = render(<SummaryCaret line="h-9" />);
    expect(container.firstElementChild).toHaveClass("h-9");
    expect(container.firstElementChild).not.toHaveClass("h-lh");
  });
});

/**
 * **One danger zone, drawn one way** — pixel-craft class 12. "Delete site"
 * was a 20px-radius band with a 16px semibold label and a "+"; "Erase …
 * personal data" a 12px-radius box with a 14px medium label and no affordance
 * at all, its border a different red, its summary 4px shorter and inset 16px.
 */
describe("DangerDisclosure", () => {
  it("draws the band at the panel radius, its summary a card face with a caret", () => {
    const { container, getByText } = render(
      <DangerDisclosure summary="Delete site">
        <p>Body</p>
      </DangerDisclosure>,
    );
    const details = container.querySelector("details");
    expect(details).toHaveClass("rounded-panel", "border", "border-danger/30", "bg-danger/5");
    const summary = container.querySelector("summary");
    for (const token of cardSummaryClass({ tone: "danger" }).split(" ")) {
      expect(summary).toHaveClass(token);
    }
    expect(summary).toHaveClass("min-h-12", "text-base", "font-semibold", "text-danger");
    expect(summary).toContainElement(getByText("Delete site"));
    expect(summary?.querySelector("svg")).toBeTruthy();
    // No glyph typed as text: a "+" reads as "add" and stays "+" when open.
    expect(summary?.textContent).toBe("Delete site");
  });

  it("opens on its own outcome, and keeps the caller's margin on the band", () => {
    const { container } = render(
      <DangerDisclosure summary="Erase" open className="mt-4">
        <p>Body</p>
      </DangerDisclosure>,
    );
    const details = container.querySelector("details");
    expect(details).toHaveAttribute("open");
    expect(details).toHaveClass("mt-4");
  });

  it("is the only danger band a <details> wears anywhere", () => {
    function files(dir: string): string[] {
      return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) return files(full);
        return /\.tsx$/.test(entry.name) && !/\.test\.tsx$/.test(entry.name) ? [full] : [];
      });
    }
    const offenders = files(SRC_DIR)
      .filter((file) => !file.endsWith(join("ui", "disclosure.tsx")))
      .filter((file) =>
        [...readFileSync(file, "utf8").matchAll(/<details\b[^>]*>/g)].some(([tag]) =>
          /\bborder-danger\b|\bbg-danger\//.test(tag),
        ),
      )
      .map((file) => relative(SRC_DIR, file).split(/[\\/]/).join("/"));
    expect(offenders).toEqual([]);
  });
});

/**
 * **A disclosure row's words start where a card's do** — pixel-craft class 5.
 * The rows were `px-5 sm:px-6` where every card on the page they live on (the
 * public schedule) is `SectionCard`'s `p-4 sm:p-5`, so their headings started
 * at 113 against the cards' 105 at 1280 and 37 against 33 at 390. One inset
 * per width: 16px, then 20px, for the summary, its body and a settled row.
 */
describe("DisclosureRow's inset", () => {
  it("is SectionCard's, at both widths, on every part of the row", () => {
    const { container, getByText } = render(
      <DisclosureRowList>
        <DisclosureRow id="deals" heading="Last-minute deals">
          <p>Body</p>
        </DisclosureRow>
        <DisclosureRowMessage id="found" heading="Check your email">
          Sent.
        </DisclosureRowMessage>
      </DisclosureRowList>,
    );
    const summary = container.querySelector("summary");
    const body = getByText("Body").parentElement;
    const message = getByText("Check your email").parentElement;
    for (const part of [summary, body, message]) {
      expect(part).toHaveClass("px-4", "sm:px-5");
      expect(part).not.toHaveClass("px-5", "sm:px-6");
    }
  });
});

describe("CompactDisclosureRow", () => {
  it("keeps the value visible and the form behind a native disclosure", () => {
    const { container, getByText } = render(
      <CompactDisclosureRow label="Languages" value="English">
        <input aria-label="language" />
      </CompactDisclosureRow>,
    );
    expect(container.querySelector("details")).toBeTruthy();
    expect(getByText("English")).toHaveClass("whitespace-normal", "break-words", "sm:truncate");
    expect(container.querySelector('input[aria-label="language"]')).toBeTruthy();
  });

  /**
   * **On a phone the value sits under its label, not under the caret** —
   * pixel-craft class 3. The summary stacked below `sm` as a column, so the
   * value started at the summary's edge: caret ink at x 20, label at 37, value
   * at 17 (staffing at 390). Below `sm` the summary is two columns, the caret
   * and the words, and the value takes the words' column on its own row, so it
   * starts where the label starts whatever the caret's width. From `sm` up it
   * is one row again, the value at the end.
   */
  it("puts the value in the label's column on a phone, and at the row's end from sm", () => {
    const { container, getByText } = render(
      <CompactDisclosureRow label="Shown on the public schedule" value="Shown as Dana">
        <input aria-label="consent" />
      </CompactDisclosureRow>,
    );
    const summary = container.querySelector("summary");
    expect(summary).toHaveClass(
      "grid",
      "grid-cols-[auto_minmax(0,1fr)]",
      "content-center",
      "sm:flex",
      "sm:justify-between",
    );
    const label = getByText("Shown on the public schedule");
    const value = getByText("Shown as Dana");
    // The caret and the label are the grid's first row: their wrapper steps
    // out of the way below `sm` and is the row's leading group from `sm` up.
    const lead = label.parentElement;
    expect(lead?.parentElement).toBe(summary);
    expect(lead).toHaveClass("contents", "sm:flex");
    expect(lead?.firstElementChild?.querySelector("svg")).toBeTruthy();
    expect(value.parentElement).toBe(summary);
    expect(value).toHaveClass("col-start-2");
    // No indent that assumes the caret's width.
    expect(value.className).not.toMatch(/\b(max-sm:)?p[sl]-\d/);
  });

  it("gives the compact row's hover state breathing room", () => {
    const { container } = render(
      <CompactDisclosureRow label="Languages" value="English">
        <input aria-label="language" />
      </CompactDisclosureRow>,
    );
    expect(container.querySelector("summary")).toHaveClass(
      "-mx-2",
      "px-2",
      "hover:bg-surface-sunken",
    );
  });
});
