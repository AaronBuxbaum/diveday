import { describe, expect, it } from "vitest";
import { fileScopedShopContext } from "@/test/db";
import { loadShopExportBundleInput } from "./export";

// The bundle's shape guards: split from export.test.ts, which holds the column decisions.
const ctx = fileScopedShopContext();

describe("export bundle shape", () => {
  it("keeps every row exactly as wide as its own header", async () => {
    const { db, shop } = ctx;
    const input = await loadShopExportBundleInput(db, shop.id);
    if (!input) throw new Error("seeded shop failed to load");

    const ragged = input.tables
      .map((table) => {
        const widths = [...new Set(table.rows.map((row) => row.length))].filter(
          (width) => width !== table.header.length,
        );
        return widths.length > 0 ? { file: table.file, header: table.header.length, widths } : null;
      })
      .filter((entry) => entry !== null);
    // A header and its projection are two hand-maintained lists that must stay
    // in step, and nothing above notices when they don't: the column test reads
    // only `header`, so adding a name there without its value passes both
    // assertions while shifting every later cell one column left. That is not a
    // hypothetical — `crew_public_consent_at` did exactly this (issue #1181),
    // and the only thing that caught it was two unrelated tests that happened
    // to read `people.csv` by header index. A shop's CSV would have carried
    // every date one column off, silently, into whatever it was imported to.
    expect(ragged).toEqual([]);
  });

  it("names every column once per file", async () => {
    const { db, shop } = ctx;
    const input = await loadShopExportBundleInput(db, shop.id);
    if (!input) throw new Error("seeded shop failed to load");

    const repeated = input.tables
      .map((table) => {
        const seen = new Set<string>();
        const twice: string[] = [];
        for (const name of table.header) {
          if (seen.has(name)) twice.push(name);
          else seen.add(name);
        }
        return twice.length > 0 ? { file: table.file, repeated: twice } : null;
      })
      .filter((entry) => entry !== null);
    // Per file, not across the bundle: `id` and `shop_id` belong in many
    // headers, and a column riding in a rollup legitimately appears beside its
    // own table's copy. What must never repeat is a name inside one header.
    //
    // Neither assertion above can see a duplicate. The column test asks only
    // whether a name appears *somewhere*, so a repeat reads as covered, and the
    // width test compares counts — a duplicated header and its duplicated
    // projection are both one wider, so the rows stay flush. `dive_sites.csv`
    // carried `conservation_note` twice through both of them, one copy sitting
    // between `fit_note` and the field-guide columns where no reader scanning
    // the list would see a repeat, and every shop's bundle shipped with it. A
    // destination importing by header name keeps whichever copy it read last.
    expect(repeated).toEqual([]);
  });
});
