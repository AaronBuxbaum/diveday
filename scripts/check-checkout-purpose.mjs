import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { filesUnder } from "./files-under.mjs";

/**
 * Every read or write of `booking_checkouts` names the purposes it means.
 *
 * A seat's checkout and a post-trip tip are one table since issue #2718: one
 * Stripe session-id space, one lifecycle, one `purpose` column (`fare` | `tip`).
 * Only a fare settles a seat. A reader written before the column existed — the
 * abandoned-checkout recovery scan, a refund, the month's revenue, the
 * confirmation page's "latest checkout for this booking" — does not throw when a
 * tip arrives through it; it emails a diver about a seat they already paid for,
 * or counts a tip as fare revenue. "Audit every reader" is a promise this script
 * keeps.
 *
 * ## What is guarded
 *
 * `.from(bookingCheckouts)`, `.update(bookingCheckouts)`, a join to it, and the
 * same three shapes on `bookingCheckoutBookings` (a tip links its one booking
 * there too). A query passes when `fareCheckout()` or `tipCheckout()`
 * (`src/db/checkout-purpose.ts`) appears inside it, within {@link QUERY_WINDOW}
 * lines and before the next anchor (the lesson `check-live-trips.mjs` learned in
 * issue #635).
 *
 * ## Saying "this one means both"
 *
 * `diveday:any-checkout-purpose: <why>` in a comment inside the query: a lookup
 * by Stripe session or PaymentIntent id that then branches on `purpose`, the
 * export bundle, erasure, the seeds.
 */

const ROOT = process.cwd();
const GUARDED_ROOTS = ["src/db", "src/features", "src/app", "src/lib"];
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx"]);
const QUERY_WINDOW = 60;

const ANCHOR =
  /\.(?:from|update)\(\s*bookingCheckouts?(?:Bookings)?\s*\)|\.(?:inner|left|right|full)Join\(\s*bookingCheckout(?:s|Bookings)\b/;
const PROOF = /fareCheckout\(\)|tipCheckout\(\)|diveday:any-checkout-purpose:[ \t]*\S/;
const IS_TEST = /\.test\.tsx?$|\.test-support\.ts$/;

/** Files that write every purpose by construction: the seeds and the demo refresh. */
const SKIPPED_FILES = new Set(
  ["src/db/seed.ts", "src/db/demo-refresh.ts"].map((file) => path.normalize(file)),
);
const SKIPPED_DIRECTORY = path.normalize("src/app/api/test/");

export function findUnnamedCheckoutReads(source) {
  const lines = source.split("\n");
  const anchors = lines.reduce((found, line, index) => {
    // Prettier breaks a long join after its parenthesis, so the table can sit
    // on the next line.
    const joined = /\.(?:inner|left|right|full)Join\(\s*$/.test(line)
      ? `${line.trim()}${(lines[index + 1] ?? "").trim()}`
      : line;
    if (ANCHOR.test(joined)) found.push(index);
    return found;
  }, []);
  // A join belongs to the query its `.from` opened, so only a `.from` or an
  // `.update` starts a new query and ends the one before it.
  const starts = anchors.filter((index) => /\.(?:from|update)\(/.test(lines[index]));
  const findings = [];
  anchors.forEach((index) => {
    const next = starts.find((start) => start > index) ?? lines.length;
    const end = Math.min(index + QUERY_WINDOW, next);
    // The allow comment may sit on the comment lines just above the anchor;
    // code above it never counts, so a neighbour's filter cannot prove it.
    let start = index;
    while (start > 0 && index - start < 3 && lines[start - 1].trim().startsWith("//")) start -= 1;
    const window = lines.slice(start, end).join("\n");
    if (PROOF.test(window)) return;
    findings.push({ line: index + 1, text: lines[index].trim() });
  });
  return { guarded: anchors.length, findings };
}

async function main() {
  const violations = [];
  let guarded = 0;
  for (const root of GUARDED_ROOTS) {
    for (const file of await filesUnder(
      root,
      (relativeDirectory) => readdir(path.join(ROOT, relativeDirectory), { withFileTypes: true }),
      (relativePath) => SOURCE_EXTENSIONS.has(path.extname(relativePath)),
    )) {
      const normalized = path.normalize(file);
      if (SKIPPED_FILES.has(normalized) || IS_TEST.test(file)) continue;
      if (normalized.startsWith(SKIPPED_DIRECTORY)) continue;
      if (path.basename(file).startsWith("seed-")) continue;
      const source = await readFile(path.join(ROOT, file), "utf8");
      const result = findUnnamedCheckoutReads(source);
      guarded += result.guarded;
      for (const finding of result.findings) {
        violations.push(`${file}:${finding.line}: ${finding.text}`);
      }
    }
  }

  if (violations.length > 0) {
    console.error(
      `Queries on \`booking_checkouts\` that name no purpose:\n${violations
        .map((violation) => `- ${violation}`)
        .join("\n")}`,
    );
    console.error(
      "Add `fareCheckout()` or `tipCheckout()` (src/db/checkout-purpose.ts) to the query's where clause. A seat's checkout and a post-trip tip share the table (issue #2718); a fare reader that sees a tip settles, refunds, recovers or reports a seat nobody bought.",
    );
    console.error(
      "A query that genuinely means both (a lookup by Stripe id that branches on `purpose`, the export bundle, erasure) says `diveday:any-checkout-purpose: <why>` in a comment inside it.",
    );
    process.exit(1);
  }
  console.log(
    `checkout-purpose: ${guarded} queries on booking_checkouts all name a purpose (or say why they don't)`,
  );
}

if (import.meta.main) await main();
