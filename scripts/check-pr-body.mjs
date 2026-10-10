#!/usr/bin/env node
// A pull request that touches a safety-critical or security-sensitive path names, in its
// body's "Reviews launched" section, the reviewer agent that path needs.
//
// AGENTS.md says the reviewer agents are "launched, never skipped": `dive-domain-expert` for
// manifests, roll call, readiness, cert gating, medical flags and erasure; `security-reviewer`
// for auth, tokens, personal or medical data, and export/import. Nothing checked it. Between
// 2026-10-07 and 2026-10-10, 17 of 85 merged pull requests mentioned a reviewer anywhere, while
// `src/lib/manifests.ts`, `src/db/seat-diver.ts` and the course-form seal all changed. A launch
// that is not written down cannot be told from one that never happened, so the body is where
// it is recorded (`.github/pull_request_template.md`), and this reads it.
//
// It checks that the reviewer is *named* with an answer — what it found, or "not needed
// because …" with a reason — never the quality of the review. A reason is a human's to judge.
//
// CI runs it in the safeguards job on every pull request event, with the body read live (so an
// edit counts on the next run) or from the event payload, and the diff against the base:
//
//   node scripts/check-pr-body.mjs --body-file <path> --base <sha>
//   node scripts/check-pr-body.mjs --body-file <path> --files <list-file>   (local, a file per line)
//
// With no `--base` and no `--files` it diffs against `origin/main`, which is what a session
// drafting a body wants.

import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { readBounded, SUBPROCESS_TIMEOUTS } from "./subprocess.mjs";

/** Never a surface: the PWA web manifest, and copy bundles every pull request edits. */
const NOT_SURFACES = [/^src\/app\/manifest\.ts$/, /^src\/i18n\/locales\//];

/**
 * The paths each reviewer owns, from AGENTS.md's hard rules. Only `src/**`: a document about a
 * manifest is not a manifest. Matched against the lowercased path.
 */
export const REVIEWS = [
  {
    agent: "dive-domain-expert",
    surface: "safety-critical (manifests, roll call, readiness, cert gating, medical, erasure)",
    patterns: [
      /manifest/,
      /roll-?call/,
      /readiness/,
      /trip-admission/,
      /certification/,
      /cert-?check/,
      /mark-?certified/,
      /medical/,
      /erase|erasure|anonymi[sz]/,
      /seat-diver/,
      /nitrox/,
    ],
  },
  {
    agent: "security-reviewer",
    surface: "security-sensitive (auth, tokens, personal or medical data, export/import)",
    patterns: [
      /^src\/proxy\.ts$/,
      /^src\/lib\/(auth|authz|auth-secret|session)\.ts$/,
      /account-tokens|user-accounts/,
      /\[token\]\/(actions|route|page|layout)\.tsx?$/,
      /^src\/app\/(invite|claim)\//,
      /^src\/(db|lib)\/(export|import)[^/]*\.ts$/,
      /^src\/features\/backup-export\//,
      /^src\/app\/api\/cron\/(backup-export|platform-backup)\//,
      /^src\/db\/schema\/(accounts|core|waivers|certifications|erasure)\.ts$/,
      /medical/,
      /erase|erasure|anonymi[sz]/,
    ],
  },
];

/** For each reviewer, the changed paths that need it. Reviewers with none are left out. */
export function reviewsNeeded(files) {
  const needed = [];
  for (const review of REVIEWS) {
    const hits = files.filter((file) => {
      if (!file.startsWith("src/") || NOT_SURFACES.some((re) => re.test(file))) return false;
      const lower = file.toLowerCase();
      return review.patterns.some((re) => re.test(lower));
    });
    if (hits.length > 0) needed.push({ ...review, files: hits });
  }
  return needed;
}

/** The body's "Reviews launched" section, HTML comments removed; null when there is none. */
export function reviewsSection(body) {
  let text = String(body ?? "").replace(/\r\n/g, "\n");
  // Strip until no comment is left: a comment whose removal exposes another is not a comment.
  for (let before = ""; before !== text; ) {
    before = text;
    text = text.replace(/<!--[\s\S]*?-->/g, "");
  }
  const match = text.match(/^##\s+Reviews[^\n]*\n([\s\S]*?)(?=^##\s|(?![\s\S]))/m);
  return match ? match[1] : null;
}

/**
 * Whether `section` names `agent` with an answer: the rest of the line after the name, less
 * punctuation, is something other than the template's own placeholder.
 */
export function reviewAnswered(section, agent) {
  for (const line of String(section ?? "").split("\n")) {
    const at = line.indexOf(agent);
    if (at === -1) continue;
    const answer = line
      .slice(at + agent.length)
      .replace(/[`*_:|—–-]/g, " ")
      .trim();
    if (answer && !/^(<[^>]*>|\.\.\.|…|tbd|todo|yes\s*\/\s*no)$/i.test(answer)) return true;
  }
  return false;
}

/** Every problem with this body for this diff, as sentences. Empty means it passes. */
export function bodyProblems({ body, files }) {
  const needed = reviewsNeeded(files);
  if (needed.length === 0) return [];
  const section = reviewsSection(body);
  const problems = [];
  for (const review of needed) {
    if (section !== null && reviewAnswered(section, review.agent)) continue;
    const shown = review.files.slice(0, 5).join(", ");
    const more = review.files.length > 5 ? ` and ${review.files.length - 5} more` : "";
    problems.push(
      `This pull request touches ${review.surface} paths (${shown}${more}), and its "## Reviews launched" section does not name \`${review.agent}\` with an answer. Launch it on the diff and write what it found, or write "\`${review.agent}\`: not needed because <reason>".`,
    );
  }
  return problems;
}

function changedFiles({ base, filesFile }) {
  if (filesFile) {
    return readFileSync(filesFile, "utf8")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
  }
  const output = readBounded("git", ["diff", "--name-only", `${base ?? "origin/main"}...HEAD`], {
    encoding: "utf8",
    timeoutMs: SUBPROCESS_TIMEOUTS.git,
  });
  return String(output).split("\n").filter(Boolean);
}

function argValue(args, name) {
  const at = args.indexOf(name);
  return at === -1 ? undefined : args[at + 1];
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const bodyFile = argValue(args, "--body-file");
  if (!bodyFile) {
    console.error(
      "Usage: node scripts/check-pr-body.mjs --body-file <path> [--base <sha> | --files <path>]",
    );
    process.exit(2);
  }
  const body = readFileSync(bodyFile, "utf8");
  const files = changedFiles({
    base: argValue(args, "--base"),
    filesFile: argValue(args, "--files"),
  });
  const problems = bodyProblems({ body, files });
  if (problems.length > 0) {
    console.error(`Pull request body:\n${problems.map((p) => `- ${p}`).join("\n")}`);
    console.error(
      "The section is in .github/pull_request_template.md; why: docs/agents/repo-checks.md#pr-body.",
    );
    process.exit(1);
  }
  const needed = reviewsNeeded(files).map((review) => review.agent);
  console.log(
    needed.length > 0
      ? `pr-body: ${needed.join(" and ")} named for ${files.length} changed files`
      : `pr-body: none of ${files.length} changed files needs a reviewer agent`,
  );
}
