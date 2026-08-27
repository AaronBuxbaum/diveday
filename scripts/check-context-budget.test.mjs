import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { LINE_WORD_CAP, measure, overlongLines } from "./check-context-budget.mjs";

/**
 * What this check has to get right is *what counts as always loaded*. A skill's
 * body is paid for only by the session that opens it; its `description:` line is
 * paid for by every session that merely exists, which is why one belongs in the
 * budget and the other must stay out of it. Counting a skill's body would make the
 * number huge, meaningless, and impossible to act on — the opposite of a ratchet.
 */

async function fixture({ agents = "", claude = "", skill = "", agent = "" } = {}) {
  const root = await mkdtemp(path.join(tmpdir(), "context-budget-"));
  await writeFile(path.join(root, "AGENTS.md"), agents);
  await writeFile(path.join(root, "CLAUDE.md"), claude);
  await mkdir(path.join(root, ".claude/skills/example"), { recursive: true });
  await writeFile(path.join(root, ".claude/skills/example/SKILL.md"), skill);
  await mkdir(path.join(root, ".claude/agents"), { recursive: true });
  await writeFile(path.join(root, ".claude/agents/reviewer.md"), agent);
  return root;
}

const SKILL = `---
name: example
description: three words here
---

# A body nobody pays for unless they open it

${Array(200).fill("body").join(" ")}
`;

const AGENT = `---
name: reviewer
description: two words
---

Instructions that only load when the agent runs.
`;

describe("what counts as always-loaded context", () => {
  it("counts a skill's description and not the body underneath it", async () => {
    const root = await fixture({ skill: SKILL, agent: AGENT });
    const measured = await measure(root);
    expect(measured[".claude/skills/*/SKILL.md (description lines)"]).toBe(3);
    expect(measured[".claude/agents/*.md (description lines)"]).toBe(2);
  });

  it("counts AGENTS.md and CLAUDE.md in full — a session gets both whether it wants them or not", async () => {
    const root = await fixture({
      agents: "one two three four five",
      claude: "@AGENTS.md",
      skill: SKILL,
      agent: AGENT,
    });
    const measured = await measure(root);
    expect(measured["AGENTS.md"]).toBe(5);
    expect(measured["CLAUDE.md"]).toBe(1);
  });
});

describe("the per-line cap", () => {
  /**
   * The shape the cap exists for: the `pnpm check:repo` row, which reached 2,553
   * words on one line before it moved to docs/agents/repo-checks.md. A whole-file
   * ratchet cannot see that — a table that grew one useful row and a cell that grew
   * a history look identical in a word count.
   */
  it("names the line and its width when one cell has become a document", async () => {
    const root = await fixture({
      agents: `| \`pnpm check\` | short |\n| \`pnpm check:repo\` | ${Array(LINE_WORD_CAP + 10)
        .fill("reason")
        .join(" ")} |\n`,
    });
    const [found, ...rest] = await overlongLines(root);
    expect(rest).toEqual([]);
    expect(found.line).toBe(2);
    expect(found.words).toBeGreaterThan(LINE_WORD_CAP);
  });

  it("leaves a long table of ordinary rows alone", async () => {
    const root = await fixture({
      agents: Array(50)
        .fill(`| \`pnpm something\` | ${Array(30).fill("word").join(" ")} |`)
        .join("\n"),
    });
    expect(await overlongLines(root)).toEqual([]);
  });
});
