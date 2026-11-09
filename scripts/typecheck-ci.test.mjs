import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { e2eBuildEnv } from "./e2e-build-env.mjs";
import { typecheckCI } from "./typecheck-ci.mjs";

describe("authoritative CI type gate", () => {
  it("generates fresh route validation before checking both app and worker", () => {
    const run = vi.fn(() => ({ status: 0 }));
    expect(typecheckCI(run)).toBe(0);
    expect(run.mock.calls.map((call) => call[1])).toEqual([
      ["exec", "next", "typegen"],
      ["typecheck"],
    ]);
    for (const call of run.mock.calls) expect(call[2].env).toEqual(e2eBuildEnv());
    const pkg = JSON.parse(readFileSync("package.json", "utf8"));
    expect(pkg.scripts.typecheck).toContain("tsc --noEmit -p src/worker");
    expect(readFileSync("tsconfig.json", "utf8")).toContain('".next/types/**/*.ts"');
  });

  it("checks only the independent worker when the required build owns the full app check", () => {
    const run = vi.fn(() => ({ status: 0 }));
    expect(typecheckCI(run, true)).toBe(0);
    expect(run.mock.calls.map((call) => call[1])).toEqual([
      ["exec", "tsc", "--noEmit", "-p", "src/worker"],
    ]);
    const workflow = readFileSync(".github/workflows/ci.yml", "utf8");
    expect(workflow).toContain(
      "needs.changes.outputs.code == 'true' && needs.changes.outputs.browser != 'false' && '--build-checks-app'",
    );
    expect(workflow).toContain(
      "if: github.event_name != 'schedule' && needs.changes.outputs.code == 'true' && needs.changes.outputs.browser != 'false'",
    );
    expect(workflow.slice(workflow.indexOf("  ci-result:"))).toContain("- build");
    // Next's configured native CLI checks all tsconfig inputs, including tests.
    expect(readFileSync("next.config.ts", "utf8")).toContain("useTypeScriptCli: true");
  });

  it("fails the safeguards gate on an independent worker diagnostic", () => {
    const run = vi.fn(() => ({ status: 1 }));
    expect(typecheckCI(run, true)).toBe(1);
  });

  it("does not accept stale routes after generation fails", () => {
    const run = vi.fn(() => ({ status: 2 }));
    expect(typecheckCI(run)).toBe(2);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("propagates application/generated-route/worker diagnostics to the mandatory gate", () => {
    const run = vi.fn().mockReturnValueOnce({ status: 0 }).mockReturnValueOnce({ status: 1 });
    expect(typecheckCI(run)).toBe(1);
    expect(readFileSync(".github/workflows/ci.yml", "utf8")).toContain(
      "run: node scripts/typecheck-ci.mjs",
    );
  });

  it("does not use a real database or remote telemetry during generation", () => {
    expect(
      e2eBuildEnv({ DATABASE_URL: "not-used", NEXT_PUBLIC_SENTRY_DSN: "not-used" }),
    ).toMatchObject({
      DIVEDAY_E2E: "1",
      DATABASE_URL: "",
      DATABASE_URL_UNPOOLED: "",
      PGLITE_DATA_DIR: "memory",
      NEXT_PUBLIC_SENTRY_DSN: "",
    });
  });
});
