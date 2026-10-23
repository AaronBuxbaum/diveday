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
 * **The state `pnpm db:merge` leaves must be both heads, not one.**
 *
 * Before snapshot version 9, `drizzle-kit generate --custom` wrote the merge
 * folder's snapshot as *one head's state whole* when the two open heads
 * **shared a parent**, each also having a parent the other lacks. This
 * repository shipped one: the merge closing `shop-units-confirmed` and
 * `dive-package-line-item` kept `dive_packages` and dropped
 * `shops.units_confirmed_at`, so the next `pnpm db:generate` re-emitted that
 * column as a fresh `ADD COLUMN` against a database that already had it
 * (issue #852). A version-9 merge node carries no state and drizzle rebuilds it
 * from the parents, which is exactly the code a shared parent once broke.
 *
 * **A unit test over hand-written snapshots could not catch this**, which is
 * why this file drives the real `drizzle-kit` over a real seven-folder project:
 * the bug is in what that binary does, and a fixture asserting what we *think*
 * it does would agree with us and be wrong.
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

/**
 * Write the project's whole schema: one `widgets` table plus optional extras.
 * `name` is the column both heads alter, which is what makes them collide.
 */
function schema(root, { widgets, name = 'text("name")', packages = false }) {
  writeFileSync(
    path.join(root, "src", "db", "schema.ts"),
    `import { pgTable, text, uuid, varchar } from "drizzle-orm/pg-core";
export const widgets = pgTable("widgets", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: ${name},
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

const snapshotOf = (root, folder) =>
  JSON.parse(readFileSync(path.join(root, "drizzle", folder, "snapshot.json"), "utf8"));

describe("pnpm db:merge", () => {
  // Nine `drizzle-kit` spawns, each loading a TypeScript config and a schema.
  // Six seconds on a laptop and past vitest's 20s default on a CI runner, so
  // the ceiling is stated rather than discovered: this is a slow test on
  // purpose, not a flaky one being papered over.
  it("closes two colliding heads that share a parent, keeping both heads' state", {
    timeout: 120_000,
  }, () => {
    const root = project();
    const held = mkdtempSync(path.join(tmpdir(), "db-merge-held-"));
    dirs.push(held);

    // `base`, then three siblings off it. `y` is the parent the two heads will
    // share; `x` and `z` are the ones each head has and the other does not.
    schema(root, { widgets: [] });
    generate(root, "base");
    const sibling = {};
    for (const column of ["x", "y", "z"]) {
      schema(root, { widgets: [column] });
      sibling[column] = generate(root, column);
      hide(root, held, sibling[column]);
    }

    // `head1` over {x, y} adds a column and gives `name` a default. The column
    // is the half #852 lost.
    show(root, held, sibling.x);
    show(root, held, sibling.y);
    schema(root, { widgets: ["x", "y", "units"], name: `text("name").default("n")` });
    const head1 = generate(root, "head1");
    hide(root, held, head1);
    hide(root, held, sibling.x);

    // `head2` over {y, z} adds a table and retypes `name`, which rewrites its
    // default too: both heads write `name`'s default, so drizzle refuses them.
    show(root, held, sibling.z);
    schema(root, { widgets: ["y", "z"], name: `varchar("name", { length: 64 })`, packages: true });
    const head2 = generate(root, "head2");
    show(root, held, sibling.x);
    show(root, held, head1);

    // Both branches are in now, and `schema.ts` is the merged truth — which is
    // the state `pnpm db:merge` is documented to be run from.
    const name = `varchar("name", { length: 64 }).default("n")`;
    schema(root, { widgets: ["x", "y", "z", "units"], name, packages: true });

    const merged = spawnSync(process.execPath, [SCRIPT], {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, DIVEDAY_DB_MERGE_ROOT: root },
    });
    // The collision is real: without it the script has nothing to do, and the
    // assertions below would pass on a folder nobody wrote.
    expect(merged.stderr).toContain("Conflicting migrations detected");
    expect(merged.status, merged.stderr).toBe(0);

    // One folder, empty of DDL, naming exactly the two heads.
    const mergeFolder = folderNamed(root, "merge-migration-heads");
    const mergeNode = snapshotOf(root, mergeFolder);
    expect(mergeNode.deltas).toEqual([]);
    expect([...mergeNode.prevIds].sort()).toEqual(
      [snapshotOf(root, head1).id, snapshotOf(root, head2).id].sort(),
    );
    expect(merged.stdout).toContain(`wrote drizzle/${mergeFolder}`);

    // And nothing is left behind: the probe that checked the state is deleted,
    // so the graph gains exactly one folder.
    expect(folders(root).filter((folder) => folder.includes("db-merge-"))).toEqual([]);

    // **The assertion the whole file exists for.** The merge state describes
    // `schema.ts`, so a plain generate has nothing to write — #852's merge
    // failed exactly here, re-emitting the lost head's column.
    const before = folders(root).length;
    spawnSync(process.execPath, [DRIZZLE_KIT, "generate", "--name", "should-be-empty"], {
      cwd: root,
      encoding: "utf8",
    });
    expect(folders(root).length).toBe(before);

    // Both heads, not one: dropping each head's addition from the schema must
    // read as a drop. A merge state that swapped which head won would pass the
    // check above only if `schema.ts` agreed with it, and would fail one of these.
    schema(root, { widgets: ["x", "y", "z"], name });
    const dropped = generate(root, "drop-both-heads");
    const sql = readFileSync(path.join(root, "drizzle", dropped, "migration.sql"), "utf8");
    expect(sql).toContain('DROP COLUMN "units"');
    expect(sql).toContain('DROP TABLE "packages"');
  });
});
