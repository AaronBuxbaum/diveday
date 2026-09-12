import path from "node:path";
import { describe, expect, it } from "vitest";
import { physicalUtilitiesInTree, staleBaselineEntries } from "./logical-properties-lib.mjs";

/**
 * The check's judgement, not its plumbing: which strings are a directional
 * utility and which merely look like one. The prose cases are the ones that
 * matter — the first version of this counted "right-hand" and "left-aligned"
 * out of comments and reported 26 violations that were sentences (issue #733).
 */
const PATTERN = (utility) =>
  new RegExp(
    `(?<![\\w-])-?(?:[a-z-]+:)*${utility}${utility.endsWith("-") ? "[\\w./\\[\\]%-]+" : ""}(?![\\w-])`,
    "g",
  );

const matches = (utility, text) => [...text.matchAll(PATTERN(utility))].map((m) => m[0]);

describe("what counts as a physical directional utility", () => {
  it("catches it with any variant stack, and negated", () => {
    expect(matches("ml-", 'className="ml-2 sm:ml-4 -ml-1 group-hover:ml-0"')).toEqual([
      "ml-2",
      "sm:ml-4",
      "-ml-1",
      "group-hover:ml-0",
    ]);
    expect(matches("left-", 'className="left-[31px] left-0"')).toEqual(["left-[31px]", "left-0"]);
  });

  /**
   * `border-r` must not eat `border-red-500`, which is the whole reason the
   * pattern is anchored on a boundary rather than a prefix — the same trap
   * `check-shop-word.mjs` documents for `tienda` inside `trastienda`.
   */
  it("does not match a colour that starts with the same letters", () => {
    expect(matches("border-r", 'className="border-red-500"')).toEqual([]);
    expect(matches("border-l", 'className="border-lime-400"')).toEqual([]);
  });

  it("does not match a word that merely contains one", () => {
    expect(matches("left-", "nothing left-over here")).toEqual(["left-over"]);
    // ...which is exactly why comments are stripped before any of this runs.
  });

  it("leaves the non-directional axis alone", () => {
    for (const utility of ["mt-", "mb-", "top-", "bottom-"]) {
      expect(
        matches(utility, 'className="mt-2 mb-4 top-0 bottom-1"').length,
        `${utility} is not directional and is not checked`,
      ).toBeGreaterThan(0);
    }
  });
});

/**
 * **The scan half**, which used to run at module scope inside the guard and
 * could therefore not be imported at all, let alone exercised (issue #1763).
 *
 * The walk and the read are two separate moments, and `pnpm check:repo` runs 48
 * guards concurrently beside whatever a session is editing — so a file listed by
 * the walk and gone by the read is an ordinary mid-edit state, not a broken
 * checkout. It used to take the whole guard down with a raw Node stack trace,
 * leaving the rest of the tree unchecked.
 */
describe("physicalUtilitiesInTree", () => {
  /** A `readdir(…, { withFileTypes: true })` stand-in over a plain directory map. */
  const listing = (tree) => async (directory) => {
    const entries = tree[directory];
    if (!entries) throw Object.assign(new Error(`ENOENT: ${directory}`), { code: "ENOENT" });
    return entries.map((name) => ({
      name,
      isDirectory: () => Boolean(tree[path.join(directory, name)]),
    }));
  };

  const vanishing = (gone) => async (file) => {
    if (gone.includes(file)) {
      throw Object.assign(new Error(`ENOENT: no such file or directory, open '${file}'`), {
        code: "ENOENT",
      });
    }
    return '<div className="ml-2" />';
  };

  it("skips a file that vanished between the walk and the read, and names it", async () => {
    const { details, vanished } = await physicalUtilitiesInTree(
      ["src/components"],
      listing({ "src/components": ["Gone.tsx", "Still.tsx"] }),
      vanishing(["src/components/Gone.tsx"]),
    );
    expect(vanished).toEqual(["src/components/Gone.tsx"]);
    // The rest of the tree is still counted: one vanished file is not a reason
    // to stop looking at the files that are there.
    expect([...details.keys()]).toEqual(["src/components/Still.tsx"]);
    expect(details.get("src/components/Still.tsx")).toEqual([
      { line: 1, text: "ml-2", logical: "ms-" },
    ]);
  });

  it("does not call a baseline entry clean or gone when its file vanished mid-run", async () => {
    const scan = await physicalUtilitiesInTree(
      ["src/components"],
      listing({ "src/components": ["Gone.tsx", "Fixed.tsx"] }),
      async (file) => {
        if (file === "src/components/Gone.tsx") {
          throw Object.assign(new Error("ENOENT: no such file or directory"), { code: "ENOENT" });
        }
        // Genuinely clean now — its baseline entry really is stale.
        return '<div className="ms-2" />';
      },
    );
    const baselineCounts = { "src/components/Fixed.tsx": 2, "src/components/Gone.tsx": 3 };
    // `Gone.tsx` was never read, so the scan knows nothing about it: telling a
    // session mid-delete to remove its entry would trade one confusing failure
    // for another. A real fall still has to be banked.
    expect(staleBaselineEntries(baselineCounts, scan)).toEqual(["src/components/Fixed.tsx"]);
  });

  it("still throws on a read error that is not a missing file", async () => {
    const read = async () => {
      throw Object.assign(new Error("EACCES: permission denied"), { code: "EACCES" });
    };
    // A permission error is a broken checkout, and swallowing it would make the
    // guard lie about its own coverage — it would report a clean tree it never
    // managed to read.
    await expect(
      physicalUtilitiesInTree(["src/components"], listing({ "src/components": ["A.tsx"] }), read),
    ).rejects.toThrow(/EACCES/);
  });
});
