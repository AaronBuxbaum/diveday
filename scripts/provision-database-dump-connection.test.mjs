import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  connectionUriRequestUrl,
  fetchDirectConnectionUri,
  isDirectConnectionUri,
  shouldUpdateConnectionUri,
} from "./provision-database-dump-connection.mjs";

describe("database dump connection provisioning", () => {
  it("uses Neon's direct connection URI endpoint for an explicit production target", () => {
    const url = connectionUriRequestUrl("project-123", {
      databaseName: "production db",
      roleName: "backup+owner",
      branchId: "br-production",
    });
    expect(url.origin).toBe("https://console.neon.tech");
    expect(url.pathname).toBe("/api/v2/projects/project-123/connection_uri");
    expect(url.searchParams.get("pooled")).toBe("false");
    expect(url.searchParams.get("database_name")).toBe("production db");
    expect(url.searchParams.get("role_name")).toBe("backup+owner");
    expect(url.searchParams.get("branch_id")).toBe("br-production");
  });

  it("accepts a direct PostgreSQL URI and rejects a pooled URI", () => {
    expect(
      isDirectConnectionUri("postgresql://dump:password@ep-db.us-east-1.aws.neon.tech/neondb"),
    ).toBe(true);
    expect(
      isDirectConnectionUri(
        "postgresql://dump:password@ep-db-pooler.us-east-1.aws.neon.tech/neondb",
      ),
    ).toBe(false);
  });

  it("updates an unset or changed secret and leaves a matching secret alone", () => {
    const direct = "postgresql://dump:password@ep-db.us-east-1.aws.neon.tech/neondb";
    expect(shouldUpdateConnectionUri("unset", direct)).toBe(true);
    expect(shouldUpdateConnectionUri(direct, direct)).toBe(false);
    expect(shouldUpdateConnectionUri("postgresql://old", direct)).toBe(true);
  });
});

describe("Neon dump connection request", () => {
  afterEach(() => vi.unstubAllGlobals());
  const target = { databaseName: "neondb", roleName: "backup_owner", branchId: "br-production" };

  it("refuses an incomplete target before making a network request", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    for (const field of Object.keys(target)) {
      await expect(
        fetchDirectConnectionUri("key", "project-123", { ...target, [field]: "" }),
      ).rejects.toThrow(/required/);
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it("sends the explicit database, role and branch to Neon", async () => {
    const uri = "postgresql://backup:secret@ep-db.aws.neon.tech/neondb";
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ uri }) });
    vi.stubGlobal("fetch", fetch);
    await expect(fetchDirectConnectionUri("key", "project-123", target)).resolves.toBe(uri);
    const [url, options] = fetch.mock.calls[0];
    expect(url.searchParams.get("database_name")).toBe("neondb");
    expect(url.searchParams.get("role_name")).toBe("backup_owner");
    expect(url.searchParams.get("branch_id")).toBe("br-production");
    expect(options.headers.Authorization).toBe("Bearer key");
  });

  it.each([
    { uri: "postgresql://backup:secret@ep-db-pooler.aws.neon.tech/neondb" },
    { uri: "https://example.com" },
    {},
  ])("rejects an unusable connection response: %j", async (payload) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => payload }));
    await expect(fetchDirectConnectionUri("key", "project-123", target)).rejects.toThrow(
      "Neon API did not return a direct PostgreSQL connection URI.",
    );
  });

  it("does not print a vendor error body containing credentials", async () => {
    const json = vi.fn().mockResolvedValue({ message: "postgresql://user:secret@host/db" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 400, json }));
    await expect(fetchDirectConnectionUri("key", "project-123", target)).rejects.toThrow(
      "HTTP 400",
    );
    expect(json).not.toHaveBeenCalled();
  });
});

describe("backup setup workflow separation", () => {
  const workflow = readFileSync(
    new URL("../.github/workflows/backup-setup.yml", import.meta.url),
    "utf8",
  );
  it("requires approval on the default branch and does not interpolate inputs into shell commands", () => {
    expect(workflow).toContain("environment: infra-deploy");
    expect(workflow).toContain(
      "github.ref == format('refs/heads/{0}', github.event.repository.default_branch)",
    );
    expect(workflow).toContain("persist-credentials: false");
    for (const [input, variable] of [
      ["branch_id", "NEON_BRANCH_ID"],
      ["database_name", "NEON_DATABASE_NAME"],
      ["role_name", "NEON_ROLE_NAME"],
    ]) {
      expect(workflow).toContain(`${variable}: $` + `{{ inputs.${input} }}`);
    }
    expect(workflow).toContain("if: steps.provision-dump-connection.outputs.first_seed == 'true'");
    expect(workflow).not.toContain("pnpm infra:deploy");
    expect(workflow).not.toContain("schedule:");
  });
});
