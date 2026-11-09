import { describe, expect, it, vi } from "vitest";
import { hashBearerToken } from "../src/lib/bearer-tokens.ts";
import { mintDemoLink } from "./demo-link.ts";

describe("operator demo-link issuer", () => {
  it("locks the exact demo owner, stores a digest, supersedes and sets 24-hour expiry", async () => {
    const db = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rows: [{ id: "account", email: "owner@demo.invalid" }] })
        .mockResolvedValue({ rows: [] }),
    };
    const link = await mintDemoLink(db, "sample-shop");
    expect(link).not.toBeNull();
    if (!link) throw new Error("no link");
    const raw = new URL(link.url).pathname.split("/").pop();
    const insert = db.query.mock.calls[2];
    expect(insert[1][1]).toBe(hashBearerToken(raw));
    expect(insert[1][3].getTime() - insert[1][2].getTime()).toBe(24 * 60 * 60 * 1000);
    expect(db.query.mock.calls[0][0]).toContain("s.is_demo = true");
    expect(db.query.mock.calls[0][0]).toContain("for update of a");
    expect(db.query.mock.calls[0][1]).toEqual(["sample-shop"]);
    expect(db.query.mock.calls[1][0]).toContain("revoked_at");
  });
  const refusedOwners = [
    [],
    [{ id: "real", email: "owner@example.com" }],
    [
      { id: "one", email: "owner@demo.invalid" },
      { id: "two", email: "other@demo.invalid" },
    ],
  ];
  it.each(refusedOwners.map((rows) => [rows]))(
    "refuses missing, real or ambiguous owners %#",
    async (rows) => {
      const db = { query: vi.fn().mockResolvedValue({ rows }) };
      expect(await mintDemoLink(db, "sample-shop")).toBeNull();
      expect(db.query).toHaveBeenCalledTimes(1);
    },
  );
});
