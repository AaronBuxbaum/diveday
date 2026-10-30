import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  GUARD_COUNT_SITES,
  gitignoredPaths,
  guardCountProblems,
  linkedSkillProblems,
  missingDocPaths,
  spawnedGuardCount,
  vendoredSkillProblems,
} from "./agent-layer.mjs";
import { findLaunchProblems, packageManagerIn } from "./mcp-launch-guard.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Every path this repository actually ships, so a fixture cannot invent one. */
const realExists = (command) => existsSync(path.resolve(ROOT, command));

/** A launch config that passes, so each case below breaks exactly one thing. */
const goodLaunch = {
  configurations: [
    { name: "diveday-dev", runtimeExecutable: "pnpm", runtimeArgs: ["dev"], port: 3000 },
  ],
};

const problemsFor = (mcpServers, launch = goodLaunch, exists = () => true) =>
  findLaunchProblems({ mcp: { mcpServers }, launch, exists });

describe("the package-manager launch guard", () => {
  it("passes the tree as it stands", () => {
    const mcp = JSON.parse(readFileSync(path.join(ROOT, ".mcp.json"), "utf8"));
    const launch = JSON.parse(readFileSync(path.join(ROOT, ".claude/launch.json"), "utf8"));
    expect(findLaunchProblems({ mcp, launch, exists: realExists })).toEqual([]);
  });

  it("accepts a binary invoked directly", () => {
    expect(problemsFor({ playwright: { command: "./node_modules/.bin/playwright-mcp" } })).toEqual(
      [],
    );
  });

  it("ignores an http server, which has no command line to corrupt", () => {
    expect(problemsFor({ vercel: { type: "http", url: "https://mcp.vercel.com" } })).toEqual([]);
  });

  // 1. The executable is not the whole story — what writes to stdout is the
  //    command line, and these are the forms that route around a `command` test.
  it.each([
    ["a bare package manager", { command: "pnpm", args: ["playwright-mcp"] }],
    ["a shell wrapper", { command: "sh", args: ["-c", "pnpm playwright-mcp"] }],
    ["env", { command: "/usr/bin/env", args: ["pnpm", "exec", "x"] }],
    ["an absolute path to one", { command: "/usr/local/bin/npx", args: ["x"] }],
    ["a nested one deep in a shell line", { command: "bash", args: ["-lc", "cd . && npm run x"] }],
  ])("refuses %s", (_name, server) => {
    const problems = problemsFor({ broken: server });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/corrupt the JSON-RPC stream/);
  });

  // 2. Spellings the original regex missed: the Windows suffixes, and the
  //    launchers that ship beside the four it knew about.
  it.each(["pnpm.cmd", "pnpx", "bunx", "bun", "corepack", "yarn", "npm.exe"])(
    "knows %s is a package manager",
    (name) => {
      expect(packageManagerIn(name)).toBeTruthy();
      expect(problemsFor({ broken: { command: name, args: ["x"] } })).toHaveLength(1);
    },
  );

  it("does not mistake a binary whose name merely contains one", () => {
    expect(packageManagerIn("pnpm-lock")).toBeUndefined();
    expect(packageManagerIn("./node_modules/.bin/npm-check-updates")).toBeUndefined();
    expect(problemsFor({ ok: { command: "./node_modules/.bin/npm-check-updates" } })).toEqual([]);
  });

  // 3. The existence check used to fire only on a literal "./node_modules/"
  //    prefix, which is the half of the original bug that let one server never
  //    once start.
  it.each([
    "./node_modules/.bin/missing",
    "node_modules/.bin/missing",
    "/opt/tools/missing",
    "../sibling/missing",
  ])("refuses %s when it does not exist", (command) => {
    const problems = problemsFor({ broken: { command } }, goodLaunch, () => false);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/which does not exist/);
  });

  it("leaves a bare name to PATH rather than looking for a file", () => {
    expect(problemsFor({ ok: { command: "next-devtools-mcp" } }, goodLaunch, () => false)).toEqual(
      [],
    );
  });

  // The launch-config rule: going through a package manager is fine there,
  // because a launch configuration's stdout is nobody's protocol channel — but
  // only while readiness is a port probe rather than a line read off it.
  it("accepts a launch configuration that declares its port", () => {
    expect(problemsFor({}, goodLaunch)).toEqual([]);
  });

  it("refuses a launch configuration that runs pnpm with no port to wait on", () => {
    const problems = problemsFor(
      {},
      {
        configurations: [{ name: "diveday-dev", runtimeExecutable: "pnpm", runtimeArgs: ["dev"] }],
      },
    );
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/without a `port`/);
  });

  it("reads a package manager out of a shell line in runtimeArgs too", () => {
    const problems = problemsFor(
      {},
      {
        configurations: [
          {
            name: "diveday-dev-local",
            runtimeExecutable: "sh",
            runtimeArgs: ["-c", "DATABASE_URL= pnpm dev --port 3200"],
          },
        ],
      },
    );
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/without a `port`/);
  });
});

describe("the stated check:repo guard count", () => {
  const texts = (n, m = n) => ({
    "AGENTS.md": `| \`pnpm check:repo\` | ${n} static guards, concurrently |`,
    "docs/agents/working-rules.md": `| \`pnpm check:repo\` | ${m} static guards over the repository |`,
    "docs/agents/repo-checks.md": `\`scripts/check-repo.mjs\` runs ${n} guard scripts concurrently`,
  });

  it("passes the tree as it stands", () => {
    const real = Object.fromEntries(
      GUARD_COUNT_SITES.map(({ file }) => [file, readFileSync(path.join(ROOT, file), "utf8")]),
    );
    const spawned = spawnedGuardCount(
      readFileSync(path.join(ROOT, "scripts/check-repo.mjs"), "utf8"),
    );
    expect(guardCountProblems(real, spawned)).toEqual([]);
  });

  it("leaves alone every site that names the spawned count", () => {
    expect(guardCountProblems(texts(44), 44)).toEqual([]);
  });

  it("names the one site that went stale", () => {
    expect(guardCountProblems(texts(44, 49), 44)).toEqual([
      "docs/agents/working-rules.md: says `pnpm check:repo` runs 49 guards; scripts/check-repo.mjs spawns 44",
    ]);
  });

  it("refuses a site reworded so the count can no longer be found", () => {
    const problems = guardCountProblems(
      { ...texts(44), "docs/agents/repo-checks.md": "runs a few dozen guards" },
      44,
    );
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/^docs\/agents\/repo-checks\.md: no longer states/);
  });

  it("counts one table row per guard", () => {
    const source = 'const checks = [\n  ["a", "check-a.mjs"],\n  ["b", "check-b.mjs"],\n];';
    expect(spawnedGuardCount(source)).toBe(2);
  });
});

describe("skills linked in from .agents/skills", () => {
  it("leaves alone a link and a lock entry that agree", () => {
    expect(linkedSkillProblems(["tdd", "triage"], ["triage", "tdd"])).toEqual([]);
  });

  it("refuses a link with no lock entry, and a lock entry with no link", () => {
    const problems = linkedSkillProblems(["tdd", "stray"], ["tdd", "orphan"]);
    expect(problems).toHaveLength(2);
    expect(problems[0]).toContain(".claude/skills/stray is linked in");
    expect(problems[1]).toContain('"orphan" is locked');
  });
});

describe("local overrides of vendored skills", () => {
  it("passes a skill that carries the local wording", () => {
    expect(
      vendoredSkillProblems({
        "triage/SKILL.md": "read the canonical index and provider contract",
      }),
    ).toEqual([]);
  });

  it("refuses a skill a sync gave back the upstream setup command", () => {
    const problems = vendoredSkillProblems({
      "to-spec/SKILL.md": "If not, tell the user to run `/setup-matt-pocock-skills`.",
    });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain(".agents/skills/to-spec/SKILL.md");
  });

  it("refuses upstream wording restored in a supporting file", () => {
    const problems = vendoredSkillProblems({
      "domain-modeling/ADR-FORMAT.md":
        "ADRs live in `docs/adr/` and use sequential numbering: 0001-slug.md.",
    });
    expect(problems).toEqual([
      expect.stringContaining(".agents/skills/domain-modeling/ADR-FORMAT.md"),
    ]);
  });
});

describe("the handoff docs' paths", () => {
  const exists = (relative) =>
    ["src/db/schema", "e2e/fixtures.ts", "src/app/s/[shopSlug]/page.tsx"].includes(relative);

  it("names a backticked path that resolves to nothing", () => {
    expect(missingDocPaths("After editing `src/db/schema.ts`, run it.", exists)).toEqual([
      "src/db/schema.ts",
    ]);
  });

  it("leaves alone a directory, a module specifier, a dynamic segment and a line number", () => {
    const text =
      "Edit `src/db/schema/`, import `e2e/fixtures`, open `src/app/s/[shopSlug]/page.tsx:12`.";
    expect(missingDocPaths(text, exists)).toEqual([]);
  });

  it("leaves alone globs, placeholders and examples", () => {
    const text = "`src/**/x.ts`, `src/app/<feature>/page.tsx`, `src/lib/example.ts`, `src/a/…`";
    expect(missingDocPaths(text, exists)).toEqual([]);
  });

  it("leaves alone a line that tells history, so a doc can say where a file used to be", () => {
    for (const line of [
      "the 8,700-line file (until 2026-10-07 `src/db/schema.ts`, now a directory)",
      "Before the guard (`scripts/check-soft-delete.mjs`) was deleted, it ran",
      "`src/components/MarketingNav.tsx` (was the nav) is now a view",
    ]) {
      expect(missingDocPaths(line, exists)).toEqual([]);
    }
  });

  it("counts a gitignored output as named, whether or not this checkout has made it yet", () => {
    // `e2e/screenshots/` exists only after a local capture run, so CI's fresh clone lacks it.
    expect([...gitignoredPaths(ROOT, ["e2e/screenshots/", "src/db/schema.ts"])]).toEqual([
      "e2e/screenshots/",
    ]);
    expect(gitignoredPaths(ROOT, [])).toEqual(new Set());
  });

  it("passes the tree as it stands", () => {
    // The guard itself reads every handoff doc; this pins the two files the review named, under
    // the guard's own rule: missing on disk and not a gitignored output.
    for (const file of ["docs/agents/working-rules.md", ".claude/skills/marketing-page/SKILL.md"]) {
      const contents = readFileSync(path.join(ROOT, file), "utf8");
      const missing = missingDocPaths(contents, (relative) =>
        existsSync(path.join(ROOT, relative)),
      );
      const ignored = gitignoredPaths(ROOT, missing);
      expect(missing.filter((token) => !ignored.has(token))).toEqual([]);
    }
  });
});

// Canonical skill trees must also cover non-Claude providers.
import { providerSkillProblems } from "./agent-layer.mjs";

describe("canonical provider skills", () => {
  it("rejects missing mirrors and divergent copies", () => {
    expect(providerSkillProblems(["verify"], { verify: false })).toHaveLength(1);
    expect(providerSkillProblems(["verify"], {})).toHaveLength(1);
  });
  it("accepts resolved canonical mirrors", () => {
    expect(providerSkillProblems(["verify"], { verify: true })).toEqual([]);
  });
});
