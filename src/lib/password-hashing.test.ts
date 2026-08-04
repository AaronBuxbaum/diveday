import { compare, getRounds } from "bcryptjs";
import { describe, expect, it } from "vitest";
import { hashPassword, PASSWORD_HASH_COST } from "./password-hashing";

describe("hashPassword", () => {
  it("writes every new hash at the one documented cost", async () => {
    const hashed = await hashPassword("correct horse battery staple");
    expect(getRounds(hashed)).toBe(PASSWORD_HASH_COST);
  });

  it("verifies with bcrypt's own compare, which reads the cost out of the hash", async () => {
    const hashed = await hashPassword("correct horse battery staple");
    expect(await compare("correct horse battery staple", hashed)).toBe(true);
    expect(await compare("wrong", hashed)).toBe(false);
  });

  it("salts, so the same password never produces the same stored hash", async () => {
    const [a, b] = await Promise.all([hashPassword("same"), hashPassword("same")]);
    expect(a).not.toBe(b);
  });

  it("keeps the cost at or above the bcrypt floor", () => {
    expect(PASSWORD_HASH_COST).toBeGreaterThanOrEqual(10);
  });
});
