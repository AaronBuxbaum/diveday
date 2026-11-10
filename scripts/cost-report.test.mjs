import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
  ARCHITECTURAL_RISKS,
  auditProbeStatus,
  generateCostReport,
  generateLiveCostReport,
  PROVIDER_INVENTORY,
  renderCliReport,
  renderMarkdownReport,
  SOURCE_TOPOLOGY,
} from "./cost-report.mjs";

describe("cost-report", () => {
  it("audits probe credentials correctly when unset", () => {
    const status = auditProbeStatus({});
    expect(status.vercel).toBe(false);
    expect(status.neon).toBe(false);
    expect(status.awsBudget).toBe("unknown");
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
    expect(report.currentSpend).toEqual({ status: "unknown", total: null, currency: null });
    expect(report.deployment.awsBudgets).toBe("unknown");
    expect(report).not.toHaveProperty("baselineMonthlySpend");
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
    expect(mdOutput).toContain("| Provider | Source inventory |");
  });

  it("keeps configured credentials separate from measured spend and deployment", () => {
    const report = generateCostReport({
      USAGE_VERCEL_TOKEN: "secret",
      USAGE_VERCEL_TEAM_ID: "team",
    });
    expect(report.probeConfiguration.vercelBillingApi).toBe("configured_not_verified");
    expect(report.currentSpend.status).toBe("unknown");
    expect(report.measurements).toEqual([]);
    expect(JSON.stringify(report)).not.toContain("secret");
    expect(
      auditProbeStatus({ USAGE_VERCEL_TOKEN: "  ", USAGE_VERCEL_TEAM_ID: "team" }).vercel,
    ).toBe(false);
    expect(report.architecturalRisks.map((risk) => risk.id)).not.toContain("W-3");
    expect(report.architecturalRisks.map((risk) => risk.id)).not.toContain("W-5");
  });

  it("carries mocked live readings with their window, units, scope and verification limits", async () => {
    const now = new Date("2026-11-10T12:00:00Z");
    const collect = vi.fn().mockResolvedValue({
      vercel_spend: { status: "measured", value: 12.5 },
      neon_compute: { status: "measured", value: 95 },
      neon_storage: { status: "unavailable", reason: "network_error" },
      neon_egress: { status: "not_configured" },
    });
    const report = await generateLiveCostReport({}, { now, collect });
    expect(collect).toHaveBeenCalledExactlyOnceWith({ env: {}, now, fetcher: undefined });
    expect(report.measurements[0]).toMatchObject({
      status: "measured",
      value: 12.5,
      unit: "usd",
      currency: "USD",
      plan: "unknown",
      currencyVerification: "collector_assumption_not_verified",
      lastVerifiedAt: null,
      period: { start: "2026-11-01T00:00:00.000Z", endExclusive: "2026-12-01T00:00:00.000Z" },
    });
    expect(report.measurements[1].scope).toContain("all returned projects");
    expect(report.measurements[2]).toMatchObject({
      status: "unavailable",
      reason: "network_error",
    });
    expect(report.measurements[2]).not.toHaveProperty("value");
    expect(report.measurements[3].status).toBe("not_configured");
    expect(report.currentSpend.total).toBeNull();
    for (const rendered of [renderCliReport(report), renderMarkdownReport(report)]) {
      expect(rendered).toContain("12.5 usd");
      expect(rendered).toContain("network_error");
      expect(rendered).toContain("last verified: unknown");
      expect(rendered).toContain("not per-project quota protection");
    }
  });

  it("fails closed for missing, invalid and failed readings", async () => {
    const invalid = await generateLiveCostReport(
      {},
      { collect: async () => ({ vercel_spend: { status: "measured", value: NaN } }) },
    );
    expect(invalid.measurements[0]).toMatchObject({
      status: "unavailable",
      reason: "invalid_sample",
    });
    expect(invalid.measurements[1]).toMatchObject({
      status: "unavailable",
      reason: "missing_sample",
    });
    const failed = await generateLiveCostReport(
      {},
      {
        collect: async () => {
          throw new Error("provider secret");
        },
      },
    );
    expect(failed.measurements.every((m) => m.status === "unavailable")).toBe(true);
    expect(JSON.stringify(failed)).not.toContain("provider secret");
  });

  it("uses the existing collector without network when credentials are absent", async () => {
    const fetcher = vi.fn(() => {
      throw new Error("network must not run");
    });
    const report = await generateLiveCostReport({}, { fetcher });
    expect(report.measurements.every((m) => m.status === "not_configured")).toBe(true);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("keeps source topology claims tied to the current implementation", () => {
    const read = (path) => readFileSync(join(process.cwd(), path), "utf8");
    expect(read(SOURCE_TOPOLOGY.manifestRoute)).toContain(
      `const STREAM_TTL_MS = ${SOURCE_TOPOLOGY.manifestRetirementSeconds}_000`,
    );
    expect(read("src/db/manifest-events.ts")).toContain(
      `LISTEN_IDLE_CLOSE_MS = ${SOURCE_TOPOLOGY.listenerIdleSeconds}_000`,
    );
    expect(read("infra/lib/global-stack.ts")).toContain("new route53.CfnHealthCheck");
    expect(read("infra/lib/infra-stack.ts")).toContain(
      'scheduleExpression: "cron(30 5 ? * MON *)"',
    );
  });

  it("runs only when this module is the process entry point", () => {
    const direct = spawnSync(
      process.execPath,
      [join(process.cwd(), "scripts", "cost-report.mjs"), "--json"],
      { encoding: "utf8" },
    );
    expect(direct.status).toBe(0);
    expect(JSON.parse(direct.stdout)).toHaveProperty("currentSpend");

    const directory = mkdtempSync(join(tmpdir(), "diveday-cost-report-"));
    const modulePath = join(process.cwd(), "scripts", "cost-report.mjs");
    const preservedSymlink = join(
      process.cwd(),
      "scripts",
      `cost-report-preserved-${process.pid}.mjs`,
    );
    try {
      const symlinkDirectory = join(directory, "symlinked");
      mkdirSync(symlinkDirectory);
      const symlink = join(symlinkDirectory, "cost-report.mjs");
      symlinkSync(modulePath, symlink);

      const linked = spawnSync(process.execPath, [symlink, "--json"], { encoding: "utf8" });
      expect(linked.status).toBe(0);
      expect(JSON.parse(linked.stdout)).toHaveProperty("currentSpend");

      symlinkSync(modulePath, preservedSymlink);
      const preservedLinked = spawnSync(
        process.execPath,
        ["--preserve-symlinks-main", preservedSymlink, "--json"],
        { encoding: "utf8" },
      );
      expect(preservedLinked.status).toBe(0);
      expect(JSON.parse(preservedLinked.stdout)).toHaveProperty("currentSpend");

      const importer = join(directory, "cost-report.mjs");
      const moduleUrl = pathToFileURL(modulePath).href;
      writeFileSync(importer, `import ${JSON.stringify(moduleUrl)};\n`);

      const imported = spawnSync(process.execPath, [importer], { encoding: "utf8" });
      expect(imported.status).toBe(0);
      expect(imported.stdout).toBe("");

      const importedWithMissingArg = spawnSync(
        process.execPath,
        ["-e", `import(${JSON.stringify(moduleUrl)})`, join(directory, "missing-argument")],
        { encoding: "utf8" },
      );
      expect(importedWithMissingArg.status).toBe(0);
      expect(importedWithMissingArg.stdout).toBe("");
    } finally {
      rmSync(preservedSymlink, { force: true });
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
