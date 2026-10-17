import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { fileScopedShopContext } from "@/test/db";
import { people, shops } from "./schema";

// A pinned DIVEDAY_CLOCK has to reach the rows a test creates (issue #2538).
const ctx = fileScopedShopContext();

describe("created_at takes the application clock", () => {
  it("stamps a row inserted without a time with the pinned DIVEDAY_CLOCK", async () => {
    vi.stubEnv("DIVEDAY_CLOCK", "2031-02-03T04:05:06.000Z");
    try {
      const [person] = await ctx.db
        .insert(people)
        .values({ shopId: ctx.shop.id, fullName: "Clock Pinned" })
        .returning();
      expect(person.createdAt.toISOString()).toBe("2031-02-03T04:05:06.000Z");

      vi.stubEnv("DIVEDAY_CLOCK", "2032-07-08T09:10:11.000Z");
      const [later] = await ctx.db
        .insert(people)
        .values({ shopId: ctx.shop.id, fullName: "Clock Moved" })
        .returning();
      expect(later.createdAt.toISOString()).toBe("2032-07-08T09:10:11.000Z");
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("keeps an explicit time the caller passes", async () => {
    const explicit = new Date("2020-01-02T03:04:05.000Z");
    const [person] = await ctx.db
      .insert(people)
      .values({ shopId: ctx.shop.id, fullName: "Explicit", createdAt: explicit })
      .returning();
    expect(person.createdAt.toISOString()).toBe(explicit.toISOString());
  });

  it("leaves the database default in place for raw SQL", async () => {
    const [row] = await ctx.db.select({ createdAt: shops.createdAt }).from(shops).limit(1);
    expect(row.createdAt).toBeInstanceOf(Date);
  });

  it("is the only way a schema column defaults to now", () => {
    const dir = path.join(__dirname, "schema");
    const offenders = readdirSync(dir)
      .filter((file) => file.endsWith(".ts") && file !== "columns.ts")
      .filter((file) =>
        /\.defaultNow\(\)/.test(
          readFileSync(path.join(dir, file), "utf8").replace(/\/\*[\s\S]*?\*\//g, ""),
        ),
      )
      .sort();
    // Use `appNowTimestamp` from ./columns: it keeps the database default and adds the app clock.
    expect(offenders).toEqual([]);
  });
});
