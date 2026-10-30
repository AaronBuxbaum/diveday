import { describe, expect, it } from "vitest";

import { comparePublicationIds, publicationIdFromEnv } from "./visual-publication-id.mjs";

describe("visual publication identity", () => {
  it("requires a valid GitHub run and attempt", () => {
    expect(publicationIdFromEnv({ GITHUB_RUN_ID: "4101", GITHUB_RUN_ATTEMPT: "2" })).toBe("4101-2");
    expect(() => publicationIdFromEnv({ GITHUB_RUN_ID: "4101" })).toThrow(
      /GITHUB_RUN_ID and GITHUB_RUN_ATTEMPT are required/u,
    );
    expect(() => publicationIdFromEnv({ GITHUB_RUN_ID: "0", GITHUB_RUN_ATTEMPT: "1" })).toThrow(
      /invalid visual publication identity/u,
    );
  });

  it("orders run IDs numerically, then orders retries within a run", () => {
    expect(comparePublicationIds("99-9", "100-1")).toBe(-1);
    expect(comparePublicationIds("4101-1", "4101-2")).toBe(-1);
    expect(comparePublicationIds("4102-1", "4101-9")).toBe(1);
    expect(comparePublicationIds("4101-2", "4101-2")).toBe(0);
    expect(comparePublicationIds(undefined, "4101-1")).toBe(-1);
  });
});
