import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { LARGE_FILE_LINES, violationFor } from "./guard-read.mjs";

/**
 * As with `guard-bash`, what matters is not that the guard refuses but that it never refuses
 * a read a session genuinely needs. Every "leaves alone" case below is a read AGENTS.md or a
 * skill explicitly asks for.
 */

async function repo() {
  const root = await mkdtemp(path.join(tmpdir(), "guard-read-"));
  await mkdir(path.join(root, "src/db"), { recursive: true });
  await mkdir(path.join(root, "drizzle/20260101_x"), { recursive: true });
  await mkdir(path.join(root, "docs"), { recursive: true });
  await writeFile(path.join(root, "src/db/small.ts"), "export const a = 1;\n");
  await writeFile(
    path.join(root, "src/db/schema.ts"),
    Array(LARGE_FILE_LINES + 50)
      .fill("export const row = 1;")
      .join("\n"),
  );
  await writeFile(
    path.join(root, "docs/long.md"),
    Array(LARGE_FILE_LINES + 50)
      .fill("a paragraph")
      .join("\n"),
  );
  await writeFile(path.join(root, "drizzle/20260101_x/migration.sql"), "select 1;");
  await writeFile(path.join(root, "drizzle/20260101_x/snapshot.json"), "{}");
  await writeFile(path.join(root, "pnpm-lock.yaml"), "lockfileVersion: 9\n");
  return root;
}

describe("generated artifacts", () => {
  it("refuses the lockfile, a Drizzle snapshot, and build output, naming Grep as the way in", async () => {
    const root = await repo();
    for (const file of [
      "pnpm-lock.yaml",
      "drizzle/20260101_x/snapshot.json",
      ".next/server/app/page.js",
      "playwright-report/index.html",
      "test-results/spec-a/trace.zip",
    ]) {
      const reason = violationFor({ file_path: path.join(root, file) }, { root });
      expect(reason, file).toMatch(/Grep/);
    }
  });

  it("still lets the schema-change skill review a generated migration's SQL", async () => {
    const root = await repo();
    expect(
      violationFor({ file_path: path.join(root, "drizzle/20260101_x/migration.sql") }, { root }),
    ).toBeNull();
  });

  it("refuses the artifact even when a range is given — there is no useful slice of a lockfile", async () => {
    const root = await repo();
    expect(
      violationFor({ file_path: path.join(root, "pnpm-lock.yaml"), limit: 20 }, { root }),
    ).not.toBeNull();
  });
});

describe("large source files", () => {
  it("refuses a whole-file read past the line cap and names the range form", async () => {
    const root = await repo();
    const reason = violationFor({ file_path: path.join(root, "src/db/schema.ts") }, { root });
    expect(reason).toMatch(/offset/);
    expect(reason).toMatch(/Grep/);
  });

  it("allows the same file with an explicit offset or limit — a range is a decision", async () => {
    const root = await repo();
    const file = path.join(root, "src/db/schema.ts");
    expect(violationFor({ file_path: file, offset: 400, limit: 80 }, { root })).toBeNull();
    expect(violationFor({ file_path: file, limit: 120 }, { root })).toBeNull();
    expect(violationFor({ file_path: file, offset: 0 }, { root })).toBeNull();
  });

  it("leaves a small file alone", async () => {
    const root = await repo();
    expect(violationFor({ file_path: path.join(root, "src/db/small.ts") }, { root })).toBeNull();
  });

  it("leaves a long document alone — a doc is read to be read", async () => {
    const root = await repo();
    expect(violationFor({ file_path: path.join(root, "docs/long.md") }, { root })).toBeNull();
  });

  it("counts the line cap exactly", async () => {
    const root = await repo();
    const lineCount = () => LARGE_FILE_LINES;
    expect(
      violationFor({ file_path: path.join(root, "src/db/small.ts") }, { root, lineCount }),
    ).toBeNull();
    expect(
      violationFor(
        { file_path: path.join(root, "src/db/small.ts") },
        { root, lineCount: () => LARGE_FILE_LINES + 1 },
      ),
    ).not.toBeNull();
  });
});

describe("what is none of this guard's business", () => {
  it("ignores anything outside the repository, including the Next.js docs AGENTS.md asks for", async () => {
    const root = await repo();
    for (const file of [
      "/etc/hosts",
      path.join(root, "node_modules/next/dist/docs/01-app/guide.md"),
      path.join(root, "../elsewhere/huge.ts"),
    ]) {
      expect(violationFor({ file_path: file }, { root }), file).toBeNull();
    }
  });

  it("ignores a payload with no usable path, and a path that does not exist", async () => {
    const root = await repo();
    expect(violationFor({}, { root })).toBeNull();
    expect(violationFor({ file_path: 42 }, { root })).toBeNull();
    expect(violationFor({ file_path: path.join(root, "src/db/missing.ts") }, { root })).toBeNull();
  });
});
