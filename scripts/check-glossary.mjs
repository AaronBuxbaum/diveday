#!/usr/bin/env node
// Every glossary entry still has its term.
//
// On 2026-08-04 the Close-out entry was written by replacing the line that read
// `- **Blocked / Ready** — the shop's one readiness vocabulary, and the only two states a booking's`
// (commit 2bedae366). The rest of that definition stayed exactly where it was, one indent
// deeper, so the readiness vocabulary — the `readinessStatusText`/`readinessStatusTone` rule
// and the offline-manifest exception `src/components/OfflineManifestView.tsx` cites by name —
// spent five weeks living inside the definition of the end-of-day ritual, opening mid-sentence
// on "readiness check has." with no antecedent. `pnpm check:docs` reads links, and a
// decapitated entry has no broken link in it, so nothing said a word.
//
// The tell is mechanical: wrapped prose never starts a line with a lowercase word right after
// a finished sentence, because English sentences start capitalized. When it does, a line above
// it was taken away. Abbreviations are the one honest way to end a line in a period without
// ending a sentence, so they are exempt.

import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const ROOT = path.join(import.meta.dirname, "..");
const GLOSSARY = "docs/product/glossary.md";

// The abbreviations this document actually ends a wrapped line with. A period here closes a
// word, not a sentence, so a lowercase word on the next line is ordinary prose.
const ABBREVIATIONS = /(?:\b[a-z]\.|\b(?:e\.g|i\.e|etc|vs|a\.m|p\.m|No|Inc|St|approx)\.)$/i;

/**
 * A continuation line of a bullet — indented, not itself a bullet — that opens a lowercase
 * word immediately after a completed sentence. That is a definition whose term was deleted.
 */
export function findDecapitatedEntries(contents) {
  const lines = contents.split("\n");
  const found = [];
  let inFence = false;

  for (let index = 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.trimStart().startsWith("```")) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    if (!/^ {2,}\S/.test(line)) continue;
    if (/^ *[-*] /.test(line)) continue;
    if (!/^\s*[a-z`]/.test(line)) continue;

    const previous = lines[index - 1].trimEnd();
    if (!/[.!?]$/.test(previous)) continue;
    if (ABBREVIATIONS.test(previous)) continue;

    found.push({ line: index + 1, text: line.trim() });
  }

  return found;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const contents = await readFile(path.join(ROOT, GLOSSARY), "utf8");
  const decapitated = findDecapitatedEntries(contents);

  if (decapitated.length > 0) {
    console.error(
      `Glossary entries that lost their term:\n${decapitated
        .map((item) => `- ${GLOSSARY}:${item.line}: ${item.text.slice(0, 140)}`)
        .join("\n")}`,
    );
    console.error(
      "A definition continues mid-sentence under the entry above it, which means its `- **Term** —` line was overwritten. Restore the term; do not re-wrap the paragraph to hide the seam.",
    );
    process.exit(1);
  }

  const terms = (contents.match(/^- \*\*[^*]+\*\*/gm) ?? []).length;
  console.log(`glossary: ${terms} entries, every one under its own term`);
}
