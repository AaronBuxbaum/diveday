import { describe, expect, it } from "vitest";
import { fileScopedShopContext } from "../../../test/db";
import { pagedCourses } from "./store";

const ctx = fileScopedShopContext();

describe("pagedCourses search", () => {
  it("reads a % or _ in the search as the character, not a wildcard", async () => {
    const { db, shop } = ctx;
    expect((await pagedCourses(db, shop.id, { query: "%", limit: 1000 })).total).toBe(0);
    expect((await pagedCourses(db, shop.id, { query: "Rescue_Diver", limit: 1000 })).total).toBe(0);
  });
});
