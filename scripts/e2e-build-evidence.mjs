import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { readBounded, SUBPROCESS_TIMEOUTS } from "./subprocess.mjs";

export const BUILD_EVIDENCE = ".next/diveday-build-evidence.json";
const ROOT_INPUT =
  /^(?:package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|(?:next|postcss|tailwind|tsconfig|instrumentation).*\.(?:json|[cm]?[jt]s)|\.env(?:\..*)?)$/;
const TEST_INPUT = /(?:^|\/)(?:__tests__|__snapshots__)(?:\/|$)|\.(?:test|spec)\.[cm]?[jt]sx?$/;

/** Content, not mtimes: checkout, deletion and preserved timestamps must invalidate evidence. */
export function buildFingerprint(root = process.cwd()) {
  const files = [];
  function walk(dir) {
    if (!existsSync(path.join(root, dir))) return;
    for (const entry of readdirSync(path.join(root, dir), { withFileTypes: true })) {
      const relative = path.posix.join(dir, entry.name);
      if (TEST_INPUT.test(relative)) continue;
      if (relative.endsWith(".tsbuildinfo")) continue;
      if (entry.isDirectory()) walk(relative);
      else if (entry.isFile() || entry.isSymbolicLink()) files.push(relative);
    }
  }
  walk("src");
  walk("public");
  walk("config");
  walk("drizzle");
  for (const entry of readdirSync(root)) {
    // Next creates/rewrites this gitignored declaration during build/typegen.
    // Its installed generator owns the contents; custom types belong under src.
    if (entry === "next-env.d.ts") continue;
    if (ROOT_INPUT.test(entry)) files.push(entry);
  }
  for (const file of [
    "node_modules/next/package.json",
    "scripts/build-service-worker.mjs",
    "scripts/e2e-build.mjs",
  ]) {
    if (existsSync(path.join(root, file))) files.push(file);
  }
  const hash = createHash("sha256");
  hash.update(
    JSON.stringify({ node: process.version, platform: process.platform, arch: process.arch }),
  );
  // Only build-time public values: the e2e profile forces Sentry off. Never emit values.
  for (const key of Object.keys(process.env)
    .filter((key) => key.startsWith("NEXT_PUBLIC_") && key !== "NEXT_PUBLIC_SENTRY_DSN")
    .sort())
    hash
      .update(key)
      .update("\0")
      .update(process.env[key] ?? "")
      .update("\0");
  for (const file of files.sort())
    hash
      .update(file)
      .update("\0")
      .update(readFileSync(path.join(root, file)))
      .update("\0");
  return hash.digest("hex");
}

export function writeBuildEvidence(root, fingerprint) {
  if (fingerprint !== buildFingerprint(root))
    throw new Error("Build inputs changed during build; rebuild before verifying.");
  let commit = null;
  try {
    commit = readBounded("git", ["rev-parse", "HEAD"], {
      cwd: root,
      encoding: "utf8",
      timeoutMs: SUBPROCESS_TIMEOUTS.git,
    }).trim();
  } catch {}
  const evidence = {
    version: 1,
    profile: "e2e",
    fingerprint,
    buildId: readFileSync(path.join(root, ".next/BUILD_ID"), "utf8").trim(),
    commit,
  };
  writeFileSync(path.join(root, BUILD_EVIDENCE), `${JSON.stringify(evidence, null, 2)}\n`);
  return evidence;
}

export function requireFreshBuild(root = process.cwd()) {
  let evidence;
  try {
    evidence = JSON.parse(readFileSync(path.join(root, BUILD_EVIDENCE), "utf8"));
  } catch {
    throw new Error("Missing production build evidence. Run `pnpm e2e:build`.");
  }
  if (
    evidence.version !== 1 ||
    evidence.profile !== "e2e" ||
    evidence.fingerprint !== buildFingerprint(root) ||
    !existsSync(path.join(root, ".next/BUILD_ID")) ||
    evidence.buildId !== readFileSync(path.join(root, ".next/BUILD_ID"), "utf8").trim()
  ) {
    throw new Error(
      "Production build is stale or unrecognized. Run `pnpm e2e:build`; spec-only edits can reuse a fresh build.",
    );
  }
  return evidence;
}
