import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "vitest";
import { BUILD_EVIDENCE, buildFingerprint, requireFreshBuild } from "./e2e-build-evidence.mjs";

function fixture(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), "build-evidence-"));
  t.onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  for (const dir of ["src", "public", "e2e", ".next"]) mkdirSync(path.join(root, dir));
  writeFileSync(path.join(root, "src/page.tsx"), "original");
  writeFileSync(path.join(root, ".next/BUILD_ID"), "build-1");
  writeFileSync(
    path.join(root, BUILD_EVIDENCE),
    JSON.stringify({
      version: 1,
      profile: "e2e",
      buildId: "build-1",
      fingerprint: buildFingerprint(root),
    }),
  );
  return root;
}
test("rejects changed component even when its mtime predates build", (t) => {
  const root = fixture(t);
  writeFileSync(path.join(root, "src/page.tsx"), "changed");
  utimesSync(path.join(root, "src/page.tsx"), 1, 1);
  assert.throws(() => requireFreshBuild(root), /stale/);
});
test("spec and unit-test edits leave a valid production build reusable", (t) => {
  const root = fixture(t);
  writeFileSync(path.join(root, "e2e/visual.spec.ts"), "new locator");
  writeFileSync(path.join(root, "src/page.test.tsx"), "new test");
  assert.equal(requireFreshBuild(root).buildId, "build-1");
});
for (const file of [
  "next.config.ts",
  "next-custom.config.ts",
  "pnpm-lock.yaml",
  "public/icon.svg",
  ".env.local",
])
  test(`rejects changed ${file}`, (t) => {
    const root = fixture(t);
    writeFileSync(path.join(root, file), "changed");
    assert.throws(() => requireFreshBuild(root), /stale/);
  });
test("rejects missing evidence, deleted source and replaced build", (t) => {
  const root = fixture(t);
  rmSync(path.join(root, "src/page.tsx"));
  assert.throws(() => requireFreshBuild(root), /stale/);
  rmSync(path.join(root, BUILD_EVIDENCE));
  assert.throws(() => requireFreshBuild(root), /Missing/);
});

test("refuses to stamp source edited during the build", async (t) => {
  const { writeBuildEvidence } = await import("./e2e-build-evidence.mjs");
  const root = fixture(t);
  const before = buildFingerprint(root);
  writeFileSync(path.join(root, "src/page.tsx"), "concurrent edit");
  assert.throws(() => writeBuildEvidence(root, before), /changed during build/);
});
test("rejects a different BUILD_ID even with identical source", (t) => {
  const root = fixture(t);
  writeFileSync(path.join(root, ".next/BUILD_ID"), "build-2");
  assert.throws(() => requireFreshBuild(root), /stale/);
});

test("Next's generated root declarations do not invalidate a build as it completes", async (t) => {
  const { writeAppTypeDeclarations } = await import(
    "next/dist/lib/typescript/writeAppTypeDeclarations.js"
  );
  const { writeBuildEvidence } = await import("./e2e-build-evidence.mjs");
  const root = fixture(t);
  const before = buildFingerprint(root);
  await writeAppTypeDeclarations({
    baseDir: root,
    distDir: ".next",
    imageImportsEnabled: true,
    hasPagesDir: false,
    hasAppDir: true,
    strictRouteTypes: false,
    typedRoutes: false,
  });
  assert.equal(writeBuildEvidence(root, before).buildId, "build-1");
  assert.equal(requireFreshBuild(root).fingerprint, before);
  // Generation is allowed; declarations authored under src remain actual inputs.
  writeFileSync(path.join(root, "src/custom-env.d.ts"), "declare const shop: string;");
  assert.throws(() => requireFreshBuild(root), /stale/);
});
