import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

/**
 * **The snapshot `pnpm db:merge` writes must describe both heads, not one.**
 *
 * `drizzle-kit generate --custom` writes the merge folder's snapshot as *one
 * head's state whole* — losing the other's — when the two open heads **share a
 * parent**, each also having a parent the other lacks. That is the ordinary
 * shape once a repository has merged a few times, and this one shipped an
 * instance of it: the merge closing `shop-units-confirmed` and
 * `dive-package-line-item` kept `dive_packages` and dropped
 * `shops.units_confirmed_at`, so the next `pnpm db:generate` re-emitted that
 * column as a fresh `ADD COLUMN` against a database that already had it
 * (issue #852).
 *
 * **A unit test over hand-written snapshots could not have caught this**, which
 * is why this file drives the real `drizzle-kit` over a real seven-folder
 * project instead. The bug is in what that binary writes; a fixture asserting
 * what we *think* it writes would have agreed with us and been wrong. Four
 * simpler shapes were tried first and every one of them unions correctly —
 * two heads off one base adding columns to the same table, the same with a
 * stale `schema.ts`, one head adding a table while the other adds a column, and
 * a head that is itself a merge node. Only the shared parent provokes it.
 *
 * The cost is a handful of `drizzle-kit` spawns, which is why there is one test
 * here rather than a suite.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(HERE, "..");
const SCRIPT = path.join(HERE, "merge-migration-heads.mjs");
const DRIZZLE_KIT = path.join(REPO, "node_modules", "drizzle-kit", "bin.cjs");

const dirs = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A throwaway drizzle project that borrows this repository's `node_modules`. */
function project() {
  const root = mkdtempSync(path.join(tmpdir(), "db-merge-"));
  dirs.push(root);
  mkdirSync(path.join(root, "src", "db"), { recursive: true });
  mkdirSync(path.join(root, "drizzle"), { recursive: true });
  symlinkSync(path.join(REPO, "node_modules"), path.join(root, "node_modules"));
  writeFileSync(
    path.join(root, "drizzle.config.ts"),
    `import { defineConfig } from "drizzle-kit";
export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  driver: "pglite",
  dbCredentials: { url: "./.pglite" },
});
`,
  );
  return root;
}

/** Write the project's whole schema: one `widgets` table plus optional extras. */
function schema(root, { widgets, packages = false }) {
  writeFileSync(
    path.join(root, "src", "db", "schema.ts"),
    `import { pgTable, text, uuid } from "drizzle-orm/pg-core";
export const widgets = pgTable("widgets", {
  id: uuid("id").primaryKey().defaultRandom(),
${widgets.map((column) => `  ${column}: text("${column}"),`).join("\n")}
});
${
  packages
    ? `export const packages = pgTable("packages", {
  id: uuid("id").primaryKey().defaultRandom(),
  label: text("label"),
});
`
    : ""
}`,
  );
}

function generate(root, name, extra = []) {
  const result = spawnSync(process.execPath, [DRIZZLE_KIT, "generate", ...extra, "--name", name], {
    cwd: root,
    encoding: "utf8",
  });
  if (result.status !== 0) throw new Error(`generate ${name} failed: ${result.stderr}`);
  return folderNamed(root, name);
}

const folders = (root) =>
  readdirSync(path.join(root, "drizzle"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);

function folderNamed(root, name) {
  const found = folders(root).find((folder) => folder.endsWith(`_${name}`));
  if (!found) throw new Error(`no migration folder named ${name}`);
  return found;
}

/** Take a folder out of the graph, so the next `generate` cannot see it. */
function hide(root, held, folder) {
  spawnSync("mv", [path.join(root, "drizzle", folder), path.join(held, folder)]);
}
function show(root, held, folder) {
  spawnSync("mv", [path.join(held, folder), path.join(root, "drizzle", folder)]);
}

const columnsOf = (root, folder, table) =>
  JSON.parse(readFileSync(path.join(root, "drizzle", folder, "snapshot.json"), "utf8"))
    .ddl.filter((entity) => entity.entityType === "columns" && entity.table === table)
    .map((entity) => entity.name);

describe("pnpm db:merge", () => {
  // Eight `drizzle-kit` spawns, each loading a TypeScript config and a schema.
  // Six seconds on a laptop and past vitest's 20s default on a CI runner, so
  // the ceiling is stated rather than discovered: this is a slow test on
  // purpose, not a flaky one being papered over.
  it("repairs a merge snapshot that lost a head, when the two heads share a parent", {
    timeout: 120_000,
  }, () => {
    const root = project();
    const held = mkdtempSync(path.join(tmpdir(), "db-merge-held-"));
    dirs.push(held);

    // `base`, then three siblings off it. `y` is the parent the two heads will
    // share; `x` and `z` are the ones each head has and the other does not.
    schema(root, { widgets: ["name"] });
    generate(root, "base");
    const sibling = {};
    for (const column of ["x", "y", "z"]) {
      schema(root, { widgets: ["name", column] });
      sibling[column] = generate(root, column);
      hide(root, held, sibling[column]);
    }

    // `head1` over {x, y} adds a column. This is the half that gets lost.
    show(root, held, sibling.x);
    show(root, held, sibling.y);
    schema(root, { widgets: ["name", "x", "y", "units"] });
    const head1 = generate(root, "head1");
    hide(root, held, head1);
    hide(root, held, sibling.x);

    // `head2` over {y, z} adds a table. This is the half that survives.
    show(root, held, sibling.z);
    schema(root, { widgets: ["name", "y", "z"], packages: true });
    generate(root, "head2");
    show(root, held, sibling.x);
    show(root, held, head1);

    // Both branches are in now, and `schema.ts` is the merged truth — which is
    // the state `pnpm db:merge` is documented to be run from.
    schema(root, { widgets: ["name", "x", "y", "z", "units"], packages: true });

    const merged = spawnSync(process.execPath, [SCRIPT], {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, DIVEDAY_DB_MERGE_ROOT: root },
    });
    expect(merged.status, merged.stderr).toBe(0);

    const mergeFolder = folderNamed(root, "merge-migration-heads");
    // **The assertion the whole file exists for.** Without the repair this
    // reads `["id", "name", "y", "z"]` — head2's state whole, with head1's `x`
    // and `units` gone and nothing to say so.
    expect(columnsOf(root, mergeFolder, "widgets").sort()).toEqual([
      "id",
      "name",
      "units",
      "x",
      "y",
      "z",
    ]);
    // The other head is still there too: a repair that swapped which head won
    // would pass the line above.
    expect(columnsOf(root, mergeFolder, "packages")).toContain("label");

    // Said out loud, because a silent repair of a silent bug is still silent.
    expect(merged.stdout).toContain("lost state from one head");
    expect(merged.stdout).toContain("units");

    // And nothing is left behind: the probe that found the loss is deleted, so
    // the graph gains exactly one folder.
    expect(folders(root).filter((folder) => folder.includes("db-merge-"))).toEqual([]);

    // The repaired snapshot now describes `schema.ts`, so a plain generate has
    // nothing to write — which is precisely what was false before.
    const before = folders(root).length;
    spawnSync(process.execPath, [DRIZZLE_KIT, "generate", "--name", "should-be-empty"], {
      cwd: root,
      encoding: "utf8",
    });
    expect(folders(root).length).toBe(before);
  });
});
