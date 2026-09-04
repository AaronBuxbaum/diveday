import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

/**
 * These tests exist for one failure mode, and it is not "does drizzle detect a
 * conflict" -- drizzle's own suite owns that. It is that this check can stop
 * detecting anything and still exit 0.
 *
 * `scripts/check-migration-graph.mjs` is a spawn of another package's CLI with
 * four flags. A drizzle-kit upgrade that renames `check`, moves the
 * commutativity walk behind an opt-in, or starts writing its report to a
 * different stream leaves a script that passes on every input, forever, with a
 * cheerful success line -- which is worse than not having the check, because
 * the deploy it was protecting is the thing that finds out. Each test below
 * builds a graph whose answer is known and asserts this script agrees.
 *
 * The fixtures are hand-written snapshots rather than generated ones: a real
 * one from `drizzle/` carries fifteen hundred DDL entries, and the whole point
 * of a fixture is that a reader can see the shape being tested. Three tiny
 * tables and a `prevIds` edge is the entire input.
 */

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), "check-migration-graph.mjs");

/** A snapshot holding one table with the given columns, plus its parents. */
function snapshot({ id, prevIds, columns }) {
  return {
    version: "8",
    dialect: "postgres",
    id,
    prevIds,
    ddl: [
      { entityType: "tables", schema: "public", name: "widgets", isRlsEnabled: false },
      ...columns.map((name) => ({
        entityType: "columns",
        schema: "public",
        table: "widgets",
        name,
        type: "text",
        typeSchema: null,
        notNull: false,
        dimensions: 0,
        default: null,
        generated: null,
        identity: null,
      })),
    ],
    renames: [],
  };
}

const dirs = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/**
 * Write a graph to a throwaway folder. Keys are folder names, in any order.
 *
 * A node carrying `snapshot: false` gets its `migration.sql` and no
 * `snapshot.json` -- the shape drizzle-orm applies and drizzle-kit cannot see.
 */
function graph(nodes) {
  const dir = mkdtempSync(path.join(tmpdir(), "migration-graph-"));
  dirs.push(dir);
  for (const [folder, node] of Object.entries(nodes)) {
    mkdirSync(path.join(dir, folder));
    writeFileSync(path.join(dir, folder, "migration.sql"), "");
    if (node.snapshot === false) continue;
    writeFileSync(path.join(dir, folder, "snapshot.json"), JSON.stringify(snapshot(node)));
  }
  return dir;
}

function check(dir) {
  const result = spawnSync(process.execPath, [SCRIPT, dir], { encoding: "utf8" });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

const base = { id: "base", prevIds: [], columns: ["id"] };

describe("check-migration-graph", () => {
  it("passes a single-headed graph", () => {
    const { status, output } = check(
      graph({
        "20260101000000_base": base,
        "20260102000000_colour": { id: "colour", prevIds: ["base"], columns: ["id", "colour"] },
      }),
    );

    expect(status).toBe(0);
    expect(output).toContain("one converged graph");
  });

  it("refuses two open heads that add the same column, and names the remedy", () => {
    const { status, output } = check(
      graph({
        "20260101000000_base": base,
        "20260102000000_left": { id: "left", prevIds: ["base"], columns: ["id", "colour"] },
        "20260103000000_right": { id: "right", prevIds: ["base"], columns: ["id", "colour"] },
      }),
    );

    expect(status).toBe(1);
    // The remedy, not just the refusal: drizzle prints a tree and no next step,
    // and an agent that cannot find the next step invents one.
    expect(output).toContain("pnpm db:merge");
    expect(output).toContain("colour");
  });

  it("accepts those same two heads once a merge node names both as parents", () => {
    // What `pnpm db:merge` writes, and the reason it works: a fork whose
    // branches reach a common leaf is skipped by drizzle's walk entirely.
    const { status } = check(
      graph({
        "20260101000000_base": base,
        "20260102000000_left": { id: "left", prevIds: ["base"], columns: ["id", "colour"] },
        "20260103000000_right": { id: "right", prevIds: ["base"], columns: ["id", "colour"] },
        "20260104000000_merge": {
          id: "merge",
          prevIds: ["left", "right"],
          columns: ["id", "colour"],
        },
      }),
    );

    expect(status).toBe(0);
  });

  it("leaves two open heads alone when they touch nothing in common", () => {
    // Deliberately not a failure. Divergence is the normal state of a repo
    // several sessions push to; only divergence over the same object can break
    // the deploy, and a check that fired on every parallel pair would be
    // waved through within a week.
    const { status } = check(
      graph({
        "20260101000000_base": base,
        "20260102000000_left": { id: "left", prevIds: ["base"], columns: ["id", "colour"] },
        "20260103000000_right": { id: "right", prevIds: ["base"], columns: ["id", "weight"] },
      }),
    );

    expect(status).toBe(0);
  });
});

/**
 * The hole this half closes is not a wrong answer -- it is a right-looking one.
 *
 * `drizzle-kit check` reads `snapshot.json` and only that: `prepareOutFolder`
 * builds its list with `.filter(existsSync)`, and `checkHandler` iterates it.
 * With no snapshots the loop body never runs and the command exits 0 with
 * "Everything's fine", which is byte-identical to the output for a graph it
 * read and found clean. `scripts/vercel-build.mjs` runs this inside the
 * production deploy, so that silence is the deploy's only word on the subject.
 *
 * The concrete route in is an upload-time exclusion: `drizzle/` is 80 MB of
 * snapshots, and cutting it is the obvious saving the first time somebody reads
 * a build log. `.vercelignore` refuses that at its foot in prose; these tests
 * are what make the refusal enforced.
 */
describe("check-migration-graph, when it has nothing to check", () => {
  it("refuses a tree of migrations with no snapshots at all", () => {
    const { status, output } = check(
      graph({
        "20260101000000_base": { ...base, snapshot: false },
        "20260102000000_colour": { id: "colour", prevIds: ["base"], snapshot: false },
      }),
    );

    // Without the guard this is the `Everything's fine` path -- exit 0 on a
    // tree where nothing was compared.
    expect(status).toBe(1);
    expect(output).toContain("not one snapshot.json");
    // The message has to say why the silence was not an answer, or the next
    // reader restores the exclusion that caused it.
    expect(output).toContain("exit 0");
    expect(output).toContain(".vercelignore");
  });

  it("refuses one folder whose SQL runs unseen, and names it", () => {
    // Smaller than the case above and the same failure: drizzle-orm's
    // `readMigrationFiles` keys on `migration.sql`, so this DDL reaches
    // production, while the commutativity walk keys on `snapshot.json` and
    // cannot collide it with anything.
    const { status, output } = check(
      graph({
        "20260101000000_base": base,
        "20260102000000_handwritten": { id: "hand", prevIds: ["base"], snapshot: false },
      }),
    );

    expect(status).toBe(1);
    expect(output).toContain("20260102000000_handwritten");
    // Not the other branch's message: a partial tree is a different remedy
    // from an absent one.
    expect(output).not.toContain("not one snapshot.json");
  });

  it("says nothing about a folder that carries no SQL either", () => {
    // `pnpm db:merge` and a half-finished `git checkout` both leave bare
    // directories about. A folder with neither file applies nothing and hides
    // nothing, so firing on it would train the reader to ignore this check.
    const dir = graph({ "20260101000000_base": base });
    mkdirSync(path.join(dir, "20260102000000_empty"));

    const { status, output } = check(dir);

    expect(status).toBe(0);
    expect(output).toContain("one converged graph");
  });

  it("still walks the graph once every folder is snapshotted", () => {
    // The guard runs before drizzle-kit, so the obvious way to break it is to
    // have it swallow the failure it stands in front of.
    const { status, output } = check(
      graph({
        "20260101000000_base": base,
        "20260102000000_left": { id: "left", prevIds: ["base"], columns: ["id", "colour"] },
        "20260103000000_right": { id: "right", prevIds: ["base"], columns: ["id", "colour"] },
      }),
    );

    expect(status).toBe(1);
    expect(output).toContain("pnpm db:merge");
  });
});
