import { describe, expect, it } from "vitest";

import {
  connectionUriRequestUrl,
  isDirectConnectionUri,
  shouldUpdateConnectionUri,
} from "./provision-database-dump-connection.mjs";

describe("database dump connection provisioning", () => {
  it("uses Neon's direct connection URI endpoint for the project default", () => {
    const url = connectionUriRequestUrl("project-123");
    expect(url.origin).toBe("https://console.neon.tech");
    expect(url.pathname).toBe("/api/v2/projects/project-123/connection_uri");
    expect(url.searchParams.get("pooled")).toBe("false");
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
