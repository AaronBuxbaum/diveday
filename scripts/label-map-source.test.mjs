import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { labelModuleName, labelModuleSources, messageKeyMaps } from "./label-map-source.mjs";

it("normalizes real label owners and excludes tests, declarations and unrelated feature files", () => {
  expect(labelModuleName("src/i18n/labels.ts")).toBe("labels.ts");
  expect(labelModuleName("src/features/future/labels.ts")).toBe("../features/future/labels.ts");
  for (const file of [
    "src/i18n/labels.test.ts",
    "src/i18n/labels.d.ts",
    "src/features/future/store.ts",
    "src/features/future/labels.test.ts",
  ]) {
    expect(labelModuleName(file)).toBeNull();
  }
});

it("discovers a future feature map so inventory equality cannot silently omit it", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "label-source-"));
  try {
    await mkdir(path.join(root, "src/i18n"), { recursive: true });
    await mkdir(path.join(root, "src/features/future"), { recursive: true });
    await mkdir(path.join(root, "src/features/unrelated"), { recursive: true });
    await writeFile(
      path.join(root, "src/i18n/local-labels.ts"),
      "const LOCAL: Record<Code, DiverMessageKey> = {};",
    );
    await writeFile(
      path.join(root, "src/i18n/decoy.test.ts"),
      "const TEST: Record<Code, DiverMessageKey> = {};",
    );
    await writeFile(
      path.join(root, "src/features/future/labels.ts"),
      "const NEW: Record<Exclude<Code, 'none'>, StaffMessageKey> = {};",
    );
    const found = (await labelModuleSources(root)).flatMap(([file, source]) =>
      messageKeyMaps(source).map((map) => `${file} ${map}`),
    );
    expect(found.sort()).toEqual(["../features/future/labels.ts NEW", "local-labels.ts LOCAL"]);
    expect(found.filter((entry) => entry !== "local-labels.ts LOCAL")).toEqual([
      "../features/future/labels.ts NEW",
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
