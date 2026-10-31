import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import {
  ARCHITECTURAL_RISKS,
  auditProbeStatus,
  generateCostReport,
  PROVIDER_INVENTORY,
  renderCliReport,
  renderMarkdownReport,
} from "./cost-report.mjs";

describe("cost-report", () => {
  it("audits probe credentials correctly when unset", () => {
    const status = auditProbeStatus({});
    expect(status.vercel).toBe(false);
    expect(status.neon).toBe(false);
    expect(status.awsBudget).toBe(true);
  });

  it("audits probe credentials correctly when configured", () => {
    const status = auditProbeStatus({
      USAGE_VERCEL_TOKEN: "tok_123",
      USAGE_VERCEL_TEAM_ID: "team_123",
      USAGE_NEON_API_KEY: "neon_123",
      USAGE_NEON_ORG_ID: "org_123",
    });
    expect(status.vercel).toBe(true);
    expect(status.neon).toBe(true);
  });

  it("generates a complete cost and risk report object", () => {
    const report = generateCostReport({});
    expect(report.providers).toEqual(PROVIDER_INVENTORY);
    expect(report.architecturalRisks).toEqual(ARCHITECTURAL_RISKS);
    expect(report.baselineMonthlySpend.minimumFixedUsd).toBeGreaterThan(0);
    expect(report.recommendations.length).toBeGreaterThan(0);
  });

  it("renders CLI and Markdown formats without error", () => {
    const report = generateCostReport({});
    const cliOutput = renderCliReport(report);
    expect(cliOutput).toContain("DIVEDAY INFRASTRUCTURE COST & RISK REPORT");
    expect(cliOutput).toContain("Vercel");
    expect(cliOutput).toContain("Neon");

    const mdOutput = renderMarkdownReport(report);
    expect(mdOutput).toContain("# DiveDay Infrastructure Cost & Risk Assessment");
    expect(mdOutput).toContain("| Provider | Tier | Monthly Base |");
  });

  it("runs only when this module is the process entry point", () => {
    const direct = spawnSync(
      process.execPath,
      [join(process.cwd(), "scripts", "cost-report.mjs"), "--json"],
      { encoding: "utf8" },
    );
    expect(direct.status).toBe(0);
    expect(JSON.parse(direct.stdout)).toHaveProperty("baselineMonthlySpend");

    const directory = mkdtempSync(join(tmpdir(), "diveday-cost-report-"));
    try {
      const modulePath = join(process.cwd(), "scripts", "cost-report.mjs");
      const symlinkDirectory = join(directory, "symlinked");
      mkdirSync(symlinkDirectory);
      const symlink = join(symlinkDirectory, "cost-report.mjs");
      symlinkSync(modulePath, symlink);

      const linked = spawnSync(process.execPath, [symlink, "--json"], { encoding: "utf8" });
      expect(linked.status).toBe(0);
      expect(JSON.parse(linked.stdout)).toHaveProperty("baselineMonthlySpend");

      const importer = join(directory, "cost-report.mjs");
      const moduleUrl = pathToFileURL(modulePath).href;
      writeFileSync(importer, `import ${JSON.stringify(moduleUrl)};\n`);

      const imported = spawnSync(process.execPath, [importer], { encoding: "utf8" });
      expect(imported.status).toBe(0);
      expect(imported.stdout).toBe("");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
