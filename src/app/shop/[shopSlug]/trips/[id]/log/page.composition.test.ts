import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The departure log is a Server Component over the incident export, behind
 * the owner gate, so these read its source rather than render it. They pin
 * the page's layout — what a printout and a phone make of it — never what it
 * records; the document's facts are pinned in `src/lib/incident-export.test.ts`
 * and `e2e/departure-log.spec.ts`.
 */
const SOURCE = readFileSync(join(__dirname, "page.tsx"), "utf8");

/** The source of the `<section>` its heading id labels, up to its close. */
function section(headingId: string): string {
  const label = SOURCE.indexOf(`aria-labelledby="${headingId}"`);
  expect(label, `the section labelled ${headingId} is where this test looks`).toBeGreaterThan(-1);
  const start = SOURCE.lastIndexOf("<section", label);
  return SOURCE.slice(start, SOURCE.indexOf("</section>", start));
}

describe("the log's section rhythm", () => {
  /**
   * The first section hung `mt-7` under the header, the next six `mt-8`, and
   * the footer `mt-10`: three steps where the page has one (ink to ink at
   * 1280, 36 / 41 / 43px — K-503, DEPARTURE-4-30). Section rhythm is one
   * `space-y-10` on the wrapper, never a margin on each section
   * (docs/design/forms-and-controls.md).
   */
  it("stacks the header, every section and the footer in one space-y-10", () => {
    const body = SOURCE.slice(SOURCE.indexOf("export default async function"));
    expect(
      /return \(\s*<div className="space-y-10">\s*<header\b/.test(body),
      "the page's root wrapper is one space-y-10 around the header and sections",
    ).toBe(true);
  });

  it("hangs no margin of its own on any section or on the footer", () => {
    const tags = SOURCE.match(/<(?:section|footer)\b[^>]*>/g) ?? [];
    expect(tags.length, "seven sections and the footer").toBe(8);
    for (const tag of tags) expect(tag).not.toMatch(/\bmt-/);
  });

  it("keeps the skeleton on the same rhythm, so nothing jumps when the log arrives", () => {
    const skeleton = readFileSync(join(__dirname, "loading.tsx"), "utf8");
    expect(skeleton).toContain('className="animate-pulse space-y-10"');
    expect(skeleton).not.toMatch(/\bmt-[78]\b/);
  });
});

describe("a timeline entry", () => {
  /**
   * Every part of an entry sat in one `flex-wrap` row with its timestamp, so a
   * part that wrapped fell back under the time: "Members at that moment"
   * started at x = 720 on one row and x = 169, under the timestamp, on the
   * next (K-550, DEPARTURE-4-36). From `sm` an entry is two columns — the time,
   * then everything else wrapping inside its own column — so a wrapped part
   * hangs under the text and never under the time.
   */
  function timelineEntry() {
    const timeline = section("incident-timeline-heading");
    return timeline.slice(timeline.indexOf("<li"), timeline.indexOf("</li>"));
  }

  /**
   * The columns are the list's, not each entry's. An entry that drew its own
   * `auto` column sized it to its own timestamp, and "Jul 21, 10:05 AM EDT" is
   * a monospace character wider than "Jul 21, 7:05 AM EDT", so on a departure
   * that ran past ten the text started ~7px apart from row to row: the ragged
   * column this fix exists to close. Every entry lays its parts on the list's
   * two tracks (`subgrid`), whose time column is the widest timestamp's.
   */
  it("is two columns from sm, one time column for every entry", () => {
    const timeline = section("incident-timeline-heading");
    const list = timeline.slice(timeline.indexOf("<ol"), timeline.indexOf("<li"));
    expect(list).toContain("sm:grid sm:grid-cols-[auto_minmax(0,1fr)]");
    const entry = timelineEntry();
    const tag = entry.slice(0, entry.indexOf(">", entry.indexOf("className=")) + 1);
    expect(tag).toContain("sm:col-span-2");
    expect(tag).toContain("sm:grid sm:grid-cols-subgrid");
    expect(tag, "an entry draws no columns of its own").not.toContain("sm:grid-cols-[");
  });

  it("holds every part but the time in one wrapping column", () => {
    const entry = timelineEntry();
    const time = entry.indexOf("{dateTime(entry.occurredAt)}");
    expect(time, "the timestamp is the entry's first part").toBeGreaterThan(-1);
    const afterTime = entry.slice(entry.indexOf("</span>", time) + "</span>".length).trimStart();
    expect(afterTime).toMatch(/^<span className="[^"]*\bflex-wrap\b[^"]*">/);
    // The wrapper closes last: everything from it to the end of the entry is
    // inside it.
    let depth = 0;
    let end = -1;
    for (const tag of afterTime.matchAll(/<span\b[^>]*?(\/?)>|<\/span>/g)) {
      if (tag[0] === "</span>") depth--;
      else if (tag[1] !== "/") depth++;
      if (depth === 0) {
        end = (tag.index ?? 0) + tag[0].length;
        break;
      }
    }
    expect(end, "the wrapper closes").toBeGreaterThan(-1);
    expect(afterTime.slice(end).trim()).toBe("");
  });
});

describe("the roster's diver cell", () => {
  /**
   * The row number and the name were one inline string, "01 Theo Lindqvist",
   * so a name that wrapped in the 144px Diver column returned under its
   * number: "Lindqvist" at x = 169, 22px left of "Theo" (K-553,
   * DEPARTURE-4-49). The number is its own box and the name hangs in a
   * column beside it; the space between them stays in the text, so the cell
   * still reads "01 Theo Lindqvist".
   */
  it("hangs a wrapped name on its own column, clear of the row number", () => {
    const roster = section("incident-roster-heading");
    const body = roster.indexOf("<TBody>");
    const cell = roster.slice(roster.indexOf("<Td>", body), roster.indexOf("</Td>", body));
    expect(cell).toMatch(/^<Td>\s*<span className="[^"]*\bflex\b[^"]*">/);
    expect(cell).toMatch(
      /<span className="[^"]*\bshrink-0\b[^"]*\btabular-nums\b[^"]*">\s*\{String\(index \+ 1\)\.padStart\(2, "0"\)\}\s*<\/span>\{" "\}\s*<span className="[^"]*\bmin-w-0\b[^"]*">\s*\{diver\.fullName\}\s*<\/span>/,
    );
  });
});

describe("the emergency contact cell", () => {
  /**
   * "Asha Sharma (sister) · +1-305-555-0231" was breakable on both sides of
   * the dot, so a narrow cell led its second line with "·" (K-552,
   * DEPARTURE-4-48). A no-break space glues the dot to the name; the phone
   * after it keeps its own `whitespace-nowrap` (issue #1035).
   */
  it("keeps the dot with the name it follows", () => {
    const at = SOURCE.indexOf("{diver.emergencyContactName}");
    expect(at, "the contact cell is where this test looks").toBeGreaterThan(-1);
    const join = SOURCE.slice(at + "{diver.emergencyContactName}".length).trimStart();
    expect(join.startsWith('{"\\u00a0"}·{" "}')).toBe(true);
  });
});

describe("the header's lines", () => {
  /**
   * "{date} · {time range} · {shop}" and "{generated} · {shop time}" joined
   * with a breakable space before each dot, and at 390 both lines already
   * wrap right at one ("EDT · Blue" / "Mantis Divers"): a slightly longer time
   * range or shop name starts a line with "·" (K-552). Each dot is glued to
   * what it follows, as on the contact cell.
   */
  it("keeps every dot with what it follows", () => {
    const header = SOURCE.slice(SOURCE.indexOf("<header"), SOURCE.indexOf("</header>"));
    const dots = [...header.matchAll(/·/g)];
    expect(dots, "the header's joins are where this test looks").toHaveLength(3);
    for (const dot of dots) {
      expect(header.slice(0, dot.index).trimEnd().endsWith('{"\\u00a0"}')).toBe(true);
    }
  });
});

describe("the log's messages", () => {
  /**
   * The joins inside the log's own messages ("{agency} · {level} · …",
   * "{date} · {name}", "Checked by {name} · {date}") are glued in the bundles,
   * where a translator sees the character, rather than patched after
   * translation: a component rewriting finished copy stops applying the
   * moment a translator changes the spacing, and reaches into interpolated
   * names too (K-552).
   */
  for (const locale of ["en-US", "es-ES"]) {
    it(`never leaves a breakable space before a dot (${locale})`, () => {
      const bundle = JSON.parse(
        readFileSync(
          join(process.cwd(), "src/i18n/locales", locale, "staff/incidentExport.json"),
          "utf8",
        ),
      ) as Record<string, string>;
      const joined = Object.entries(bundle).filter(([, message]) => message.includes("·"));
      expect(joined.length, "the bundle's joins are where this test looks").toBe(5);
      for (const [key, message] of joined) expect(message, key).not.toMatch(/[^\u00a0]·/);
    });
  }
});

describe("the pre-departure check", () => {
  /**
   * Two columns — the item and who checked it when — under a `36rem` scroll
   * floor: 576px in a phone's 356px shell, so the Status column began at
   * x ≈ 321 and 220px of it sat off screen behind a sideways scroll (K-279,
   * DEPARTURE-4-22). Two columns share a phone's width and wrap; the floor is
   * for the roll-call tables, whose column count grows with the dives.
   */
  it("lets its two columns share a phone's width rather than scroll", () => {
    const tables = section("incident-checklist-heading").match(/<Table\b[^>]*>/g) ?? [];
    expect(tables).toHaveLength(1);
    expect(tables[0]).not.toContain("minWidth");
  });
});

describe("the roll-call tables' columns", () => {
  /**
   * Under `table-layout: fixed` a table that names no widths splits into equal
   * columns, so the roster's six were 125px each on paper and 149px on screen:
   * a checkpoint's "Awaiting roll call" had as much room as the buddy cell
   * beside it, which ran four and five lines (K-104, DEPARTURE-8-20). The
   * checkpoint columns are pinned — 8rem on screen, and on paper the share
   * `rollCallCheckpointPrintClass` picks for the count — and the diver,
   * contact and buddy columns share the rest.
   */
  for (const id of ["incident-roster-heading", "incident-crew-heading"]) {
    it(`pins each checkpoint column on screen and on paper (${id})`, () => {
      const headers = section(id).match(/<Th\b[^>]*>\s*\{checkpointText\(checkpoint\)\}/g) ?? [];
      expect(headers).toHaveLength(1);
      expect(headers[0]).toContain('width="8rem"');
      expect(headers[0]).toContain("className={checkpointPrintClass}");
    });
  }

  it("takes the paper share from the checkpoint count", () => {
    expect(SOURCE).toContain(
      "const checkpointPrintClass = rollCallCheckpointPrintClass(doc.meta.checkpoints.length);",
    );
  });
});
