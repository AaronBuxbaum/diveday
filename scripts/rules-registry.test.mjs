import { describe, expect, it } from "vitest";

import {
  citedSources,
  GUARDS,
  headerSentence,
  registryProblems,
  renderRegistry,
  rulesRegistry,
} from "./rules-registry.mjs";

describe("the rules registry", () => {
  it("passes the tree as it stands", async () => {
    expect(registryProblems(await rulesRegistry())).toEqual([]);
  });

  it("holds every guard and every rule test", async () => {
    const rows = await rulesRegistry();
    expect(rows.filter((row) => row.kind === "guard")).toHaveLength(GUARDS.length);
    expect(rows.some((row) => row.holder === "src/lib/cookie-scope.test.ts")).toBe(true);
  });

  it("reads the first sentence of a header past a shebang and the imports", () => {
    const source = [
      "#!/usr/bin/env node",
      'import { a } from "./a.mjs";',
      "",
      "// **Every seat is a seat.** Said once,",
      "// here.",
      "",
      "// Not this block.",
    ].join("\n");
    expect(headerSentence(source)).toBe("**Every seat is a seat.**");
  });

  it("finds no header under code", () => {
    expect(headerSentence("const x = 1;\n// late comment.")).toBe("");
  });

  it("cites ADRs, human decisions and issues once each", () => {
    expect(
      citedSources(
        "ADR 20260730-feature-module-contracts, H-20261014-seat-is-the-word, issue #12, issue #12",
      ),
    ).toEqual(["ADR 20260730-feature-module-contracts", "H-20261014-seat-is-the-word", "#12"]);
  });

  it("refuses a missing holder, a silent one, and a cited decision that does not exist", () => {
    const rows = [
      {
        id: "gone",
        kind: "guard",
        holder: "scripts/check-gone.mjs",
        exists: false,
        sentence: "",
        sources: [],
      },
      {
        id: "mute",
        kind: "guard",
        holder: "scripts/check-mute.mjs",
        exists: true,
        sentence: "",
        sources: [],
      },
      {
        id: "ghost",
        kind: "rule test",
        holder: "src/ghost.test.ts",
        exists: true,
        sentence: "A ghost.",
        sources: ["ADR 20990101-never", "#5"],
      },
    ];
    expect(registryProblems(rows)).toEqual([
      "rules registry: gone's holder scripts/check-gone.mjs does not exist",
      "rules registry: scripts/check-mute.mjs has no header comment; open it with the sentence it holds",
      "rules registry: src/ghost.test.ts cites ADR 20990101-never, but docs/architecture/decisions/20990101-never.md does not exist",
    ]);
  });

  it("renders a table a pipe in a sentence cannot break", () => {
    const table = renderRegistry([
      { id: "a", kind: "guard", holder: "scripts/check-a.mjs", sentence: "x | y.", sources: [] },
    ]);
    expect(table.split("\n")[2]).toBe("| a | guard | x \\| y. | none | `scripts/check-a.mjs` |");
  });
});
