import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { bootstrap, capabilities } from "./agent-bootstrap.mjs";

describe("provider capability honesty", () => {
  it.each(["codex", "other"])("never claims %s lifecycle parity", (provider) => {
    expect(capabilities(provider).lifecycleHooks).toBe("not configured by repository");
    expect(capabilities(provider).scopedRules).toContain("explicitly");
  });
  it("distinguishes configured Claude hooks from observed execution", () => {
    expect(capabilities("claude").lifecycleHooks).toContain("not verified");
  });
});

it("bootstraps the checkout and recommends the installed formatter", () => {
  const result = bootstrap(process.cwd(), "codex");
  expect(result.runtimeProblem).toBeNull();
  expect(result.head).toMatch(/^[a-f0-9]{40}$/);
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  expect(pkg.devDependencies["@biomejs/biome"]).toBeTruthy();
  expect(result.formatting).toContain("biome check --write");
});
