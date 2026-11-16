#!/usr/bin/env node
// **Every user story names its proof, and every proof names a real story.**
//
// docs/product/stories/ writes down what each persona can do, one `### ID Title` per story, in plain
// words with a "Done when" list. A test claims a story with a `// story: ID` comment on the line
// above its `test(`, `it(` or `describe(`. This guard fails on a story no test claims and no open
// issue owns (`**Gap:** #1234`), a marker that names no story, a marker that sits above nothing,
// a duplicate id, a gap line on a story that now has proof, and a gap line with no issue number.
// A story only a person can judge says `**Judged:**` and how. The format and the reasoning are in
// docs/product/stories/README.md.
//
//   node scripts/check-stories.mjs             check, then print one summary line
//   node scripts/check-stories.mjs --report    print the coverage report as markdown, never written
//
// The report is not committed: a generated table in a shared doc was the top merge-conflict file
// for the human-decision index, so coverage is derived on demand.

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

export const STORIES_DIR = "docs/product/stories";
const PROOF_ROOTS = ["e2e", "src"];
const PROOF_FILE = /\.(?:spec|test)\.tsx?$/;
const SKIP_DIRS = new Set(["node_modules", ".next", "dist"]);

const STORY_HEADING = /^###\s+([A-Z]{2,6}-\d{2})\s+(.+?)\s*$/;
const MARKER = /^\s*\/\/\s*story:\s*(.+?)\s*$/;
const ID_IN_MARKER = /[A-Z]{2,6}-\d{2}/g;
const DECLARATION = /^\s*(?:test|it|describe)(?:\.[A-Za-z]+)*\s*\(/;
const DISABLED = /^\s*(?:test|it|describe)\.(?:skip|fixme)\b/;
const COMMENT_LINE = /^\s*\/\//;

/** Stories from one persona file: `[{ id, title, persona, file, line, gap, judged }]`. */
export function parseStories(markdown, file) {
  const lines = markdown.split("\n");
  const persona =
    lines
      .find((line) => line.startsWith("# "))
      ?.slice(2)
      .trim() ?? file;
  const stories = [];
  let current = null;
  lines.forEach((text, index) => {
    const heading = text.match(STORY_HEADING);
    if (heading) {
      current = {
        id: heading[1],
        title: heading[2],
        persona,
        file,
        line: index + 1,
        gap: null,
        judged: false,
        gapWithoutIssue: false,
      };
      stories.push(current);
      return;
    }
    if (/^#{1,3}\s/.test(text)) current = null;
    if (!current) return;
    const gap = text.match(/^\*\*Gap:\*\*\s*(.*)$/);
    if (gap) {
      const issue = gap[1].match(/#(\d+)/);
      if (issue) current.gap = Number(issue[1]);
      else current.gapWithoutIssue = true;
    }
    if (/^\*\*Judged:\*\*\s*\S/.test(text)) current.judged = true;
  });
  return stories;
}

/**
 * Markers in one proof file: `[{ ids, file, line, declared }]`. `declared` is false when the
 * marker sits above something that is not a test, and "disabled" when that test is skipped.
 */
export function parseMarkers(source, file) {
  const lines = source.split("\n");
  const markers = [];
  lines.forEach((text, index) => {
    const match = text.match(MARKER);
    if (!match) return;
    let next = index + 1;
    while (next < lines.length && COMMENT_LINE.test(lines[next]) && !MARKER.test(lines[next]))
      next += 1;
    const target = lines[next] ?? "";
    markers.push({
      ids: match[1].match(ID_IN_MARKER) ?? [],
      raw: match[1],
      file,
      line: index + 1,
      declared: DECLARATION.test(target) ? (DISABLED.test(target) ? "disabled" : "test") : false,
    });
  });
  return markers;
}

/** Every problem, and the coverage it was measured from. */
export function auditStories(stories, markers) {
  const problems = [];
  const byId = new Map();
  for (const story of stories) {
    const where = `${story.file}:${story.line} (${story.id})`;
    if (byId.has(story.id)) {
      problems.push(
        `${where}: id also used at ${byId.get(story.id).file}:${byId.get(story.id).line}.`,
      );
      continue;
    }
    byId.set(story.id, story);
  }
  const proof = new Map(stories.map((story) => [story.id, []]));
  for (const marker of markers) {
    const where = `${marker.file}:${marker.line}`;
    if (marker.ids.length === 0) {
      problems.push(`${where}: "story: ${marker.raw}" names no story id (e.g. BOOK-01).`);
      continue;
    }
    if (!marker.declared) {
      problems.push(
        `${where}: a story marker must sit directly above a test( / it( / describe( line.`,
      );
      continue;
    }
    for (const id of marker.ids) {
      if (!byId.has(id)) {
        problems.push(`${where}: ${id} is not a story in ${STORIES_DIR}/.`);
      } else if (marker.declared === "disabled") {
        problems.push(`${where}: ${id} is claimed by a skipped test, which proves nothing.`);
      } else {
        proof.get(id).push(`${marker.file}:${marker.line}`);
      }
    }
  }
  for (const story of byId.values()) {
    const where = `${story.file}:${story.line} (${story.id})`;
    const proven = proof.get(story.id).length > 0;
    if (story.gapWithoutIssue) problems.push(`${where}: a **Gap:** line names no issue (#1234).`);
    else if (!proven && story.gap === null && !story.judged)
      problems.push(
        `${where}: no test claims it. Add "// story: ${story.id}" above the test that proves it, or file a gap issue and write **Gap:** #N, or say how a person checks it with **Judged:**.`,
      );
    else if (proven && story.gap !== null)
      problems.push(`${where}: has proof now, so delete its **Gap:** #${story.gap} line.`);
    else if (proven && story.judged)
      problems.push(`${where}: has proof now, so delete its **Judged:** line.`);
  }
  return { problems, proof, byId };
}

function walk(dir, out) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (PROOF_FILE.test(entry.name)) out.push(full);
  }
}

export function loadAll(root) {
  const dir = path.join(root, STORIES_DIR);
  const stories = readdirSync(dir)
    .filter((name) => name.endsWith(".md") && name !== "README.md")
    .sort()
    .flatMap((name) =>
      parseStories(readFileSync(path.join(dir, name), "utf8"), `${STORIES_DIR}/${name}`),
    );
  const files = [];
  for (const proofRoot of PROOF_ROOTS) walk(path.join(root, proofRoot), files);
  const markers = files.flatMap((file) => {
    const source = readFileSync(file, "utf8");
    return source.includes("// story:")
      ? parseMarkers(source, path.relative(root, file).split(path.sep).join("/"))
      : [];
  });
  return { stories, markers };
}

/** The coverage report as markdown, grouped by persona file. */
export function renderReport(stories, proof) {
  const out = ["# Story coverage", ""];
  const personas = [...new Set(stories.map((story) => story.persona))];
  for (const persona of personas) {
    out.push(`## ${persona}`, "", "| Story | Proof | Status |", "| --- | --- | --- |");
    for (const story of stories.filter((s) => s.persona === persona)) {
      const refs = proof.get(story.id) ?? [];
      const status = refs.length
        ? "proven"
        : story.gap !== null
          ? `gap #${story.gap}`
          : story.judged
            ? "judged"
            : "UNCOVERED";
      out.push(`| ${story.id} ${story.title} | ${refs.join("<br>") || "—"} | ${status} |`);
    }
    out.push("");
  }
  return out.join("\n");
}

function main() {
  const { stories, markers } = loadAll(process.cwd());
  const { problems, proof } = auditStories(stories, markers);
  if (process.argv.includes("--report")) {
    console.log(renderReport(stories, proof));
    return;
  }
  if (problems.length > 0) {
    console.error(
      `User stories out of step with their tests:\n${problems.map((p) => `- ${p}`).join("\n")}`,
    );
    console.error(
      `A story is proven by a "// story: ID" comment above a test, owned by a **Gap:** issue, or **Judged:** by a person. See ${STORIES_DIR}/README.md.`,
    );
    process.exit(1);
  }
  const proven = stories.filter((story) => proof.get(story.id)?.length).length;
  const gaps = stories.filter((story) => story.gap !== null).length;
  const judged = stories.filter((story) => story.judged).length;
  console.log(
    `stories: ${stories.length} stories, ${proven} proven, ${gaps} gaps with an issue, ${judged} judged by a person`,
  );
}

if (import.meta.main) main();
