import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

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
