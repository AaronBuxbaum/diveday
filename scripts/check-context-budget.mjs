// Ratchets the size of the agent context every session loads before it reads a single
// line of code.
//
// `CLAUDE.md` imports `AGENTS.md`, so both are in every session's prompt in full — the
// main loop's and every subagent's alike — and so is the `description:` line of every
// skill and reviewer agent, since those are the listings a session picks from. Nothing
// else in this repository is paid for that unconditionally, and nothing was counting it.
//
// It rots in one specific way: a rule gets written where it is enforced, then its
// reasoning, then the incident that produced the reasoning, and a table cell becomes an
// essay. On 2026-08-27 the `pnpm check:repo` row was 2,553 words — a fifth of AGENTS.md,
// narrating 36 guards for a reader who at that moment wanted to know the command's name.
// Every one of those words was true, well-written, and worth keeping; none of it belonged
// in front of a session that had not yet gone red. It moved to
// docs/agents/repo-checks.md, and the row became a pointer.
//
// So this guard holds two lines. A **per-file ratchet** like check:copy's — a count may
// never rise, and a fall is banked with `--write` — which makes growth a decision somebody
// makes on purpose rather than one that accretes. And a **per-line cap**, because the
// ratchet alone cannot tell a table that grew a useful row from a cell that grew a
// history: one line may not carry more than LINE_WORD_CAP words. The fix for a red cap is
// never to compress the prose, which loses the reasoning that made it worth writing — it
// is to move the long half into `docs/` and leave a link, which is strictly better for
// the session that actually needs it, since that session arrives knowing what it is
// looking for.
//
// `--report <path>` writes the current numbers. `--write` banks a reduction and refuses to
// bank growth. Growth is not forbidden — documentation that may never grow is documentation
// that goes stale — but it is never silent: `--absorb "<why>"` raises a budget to the current
// count and records the reason and the date in the baseline, so a raise arrives in the diff
// with its justification attached instead of as a number that drifted.

import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const ROOT = process.cwd();
const BASELINE = "scripts/context-budget-baseline.json";

// Just above the longest line as of the extraction above (226 words, the `pnpm e2e` row).
// A cell that wants more than this is a document.
export const LINE_WORD_CAP = 240;

// Roughly a word and a third per token for English prose with code spans; used only for
// the human-readable report, never for a threshold.
const TOKENS_PER_WORD = 1.35;

function words(text) {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

/** The `description:` line of a skill or agent — the part a session loads without asking. */
function frontmatterDescription(contents) {
  const block = contents.match(/^---\n([\s\S]*?)\n---/);
  if (!block) return "";
  const line = block[1].match(/^description:\s*(.*)$/m);
  return line ? line[1] : "";
}

async function listDirs(root, relative) {
  const entries = await readdir(path.join(root, relative), { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

/** Every file whose full text or description reaches a session unconditionally. */
export async function measure(root = ROOT) {
  const measured = {};

  for (const file of ["CLAUDE.md", "AGENTS.md"]) {
    measured[file] = words(await readFile(path.join(root, file), "utf8"));
  }

  let skillDescriptions = 0;
  for (const dir of await listDirs(root, ".claude/skills")) {
    const file = path.join(root, ".claude/skills", dir, "SKILL.md");
    skillDescriptions += words(frontmatterDescription(await readFile(file, "utf8")));
  }
  measured[".claude/skills/*/SKILL.md (description lines)"] = skillDescriptions;

  let agentDescriptions = 0;
  for (const file of (await readdir(path.join(root, ".claude/agents"))).sort()) {
    if (!file.endsWith(".md")) continue;
    const contents = await readFile(path.join(root, ".claude/agents", file), "utf8");
    agentDescriptions += words(frontmatterDescription(contents));
  }
  measured[".claude/agents/*.md (description lines)"] = agentDescriptions;

  return measured;
}

/** Lines over the cap, as `{ file, line, words, preview }`. */
export async function overlongLines(root = ROOT, cap = LINE_WORD_CAP) {
  const found = [];
  for (const file of ["CLAUDE.md", "AGENTS.md"]) {
    const lines = (await readFile(path.join(root, file), "utf8")).split("\n");
    lines.forEach((text, index) => {
      const count = words(text);
      if (count > cap) {
        found.push({ file, line: index + 1, words: count, preview: text.trim().slice(0, 80) });
      }
    });
  }
  return found;
}

async function main() {
  const args = process.argv.slice(2);
  const reportPath = args.includes("--report") ? args[args.indexOf("--report") + 1] : null;
  const write = args.includes("--write");
  const absorb = args.includes("--absorb") ? args[args.indexOf("--absorb") + 1] : null;

  const measured = await measure();
  const baseline = JSON.parse(await readFile(path.join(ROOT, BASELINE), "utf8"));
  const budgets = baseline.budgets ?? {};

  const total = Object.values(measured).reduce((sum, count) => sum + count, 0);
  const budgetTotal = Object.values(budgets).reduce((sum, count) => sum + count, 0);

  if (reportPath) {
    const rows = Object.entries(measured)
      .sort((a, b) => b[1] - a[1])
      .map(([file, count]) => `| ${file} | ${count} | ${budgets[file] ?? "-"} |`);
    await writeFile(
      path.join(ROOT, reportPath),
      `# Always-loaded agent context\n\n` +
        `Total ${total} words (~${Math.round((total * TOKENS_PER_WORD) / 100) * 100} tokens), ` +
        `budget ${budgetTotal}.\n\n` +
        `| File | Words | Budget |\n| --- | --- | --- |\n${rows.join("\n")}\n`,
    );
    console.log(`context-budget: wrote ${reportPath}`);
  }

  if (absorb !== null) {
    if (!absorb || absorb.startsWith("--")) {
      console.error(
        'context-budget: --absorb needs a reason — `--absorb "new switching-guide row"`. The reason is the whole point: it is what a reader sees in the diff when the budget moves.',
      );
      process.exit(1);
    }
    const raised = Object.entries(measured).filter(
      ([file, count]) => count > (budgets[file] ?? Number.POSITIVE_INFINITY),
    );
    await writeFile(
      path.join(ROOT, BASELINE),
      `${JSON.stringify(
        {
          ...baseline,
          budgets: { ...budgets, ...Object.fromEntries(raised) },
          raises: [
            ...(baseline.raises ?? []),
            {
              why: absorb,
              files: Object.fromEntries(
                raised.map(([file, count]) => [file, `${budgets[file]} -> ${count}`]),
              ),
            },
          ],
        },
        null,
        2,
      )}\n`,
    );
    console.log(
      raised.length > 0
        ? `context-budget: raised ${raised.map(([file, count]) => `${file} -> ${count}`).join(", ")} (${absorb})`
        : "context-budget: nothing over budget to raise",
    );
    process.exit(0);
  }

  if (write) {
    const next = {};
    for (const [file, count] of Object.entries(measured)) {
      // A ratchet only ever turns one way: bank the fall, never the growth.
      next[file] = Math.min(count, budgets[file] ?? count);
    }
    await writeFile(
      path.join(ROOT, BASELINE),
      `${JSON.stringify({ ...baseline, budgets: next }, null, 2)}\n`,
    );
    const banked = Object.entries(next).filter(([file, count]) => count < (budgets[file] ?? count));
    console.log(
      banked.length > 0
        ? `context-budget: banked ${banked.map(([file, count]) => `${file} -> ${count}`).join(", ")}`
        : "context-budget: nothing to bank",
    );
    process.exit(0);
  }

  const problems = [];

  for (const [file, count] of Object.entries(measured)) {
    const budget = budgets[file];
    if (budget === undefined) {
      problems.push(
        `${file}: no entry in ${BASELINE} — every always-loaded surface needs a budget; run \`node scripts/check-context-budget.mjs --write\` once you have decided what it should be`,
      );
      continue;
    }
    if (count > budget) {
      problems.push(
        `${file}: ${count} words, over its ${budget}-word budget by ${count - budget}. Every session pays for this file in full. Move the long half into docs/ and leave a link, or delete what stopped being true — do not compress the prose, which costs the reasoning and saves little.`,
      );
    }
  }

  for (const line of await overlongLines()) {
    problems.push(
      `${line.file}:${line.line}: one line carries ${line.words} words (cap ${LINE_WORD_CAP}) — "${line.preview}...". A table cell this long is a document: move the reasoning to docs/agents/ and leave a pointer, the way the check:repo row did.`,
    );
  }

  if (problems.length > 0) {
    console.error(`Agent context over budget:\n${problems.map((item) => `- ${item}`).join("\n")}`);
    process.exit(1);
  }

  const slack = budgetTotal - total;
  console.log(
    `context-budget: ${total} words always loaded (~${Math.round((total * TOKENS_PER_WORD) / 100) * 100} tokens)` +
      `${slack > 0 ? `, ${slack} under budget — bank it with --write` : ", at budget"}`,
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
