import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it, vi } from "vitest";
import { demoCredentials, listDemos, parseDemoAccessArgs } from "./demo-access.ts";

const shop = {
  id: "demo-id",
  slug: "coral-cove",
  name: "Coral Cove",
  created_at: "2026-11-09T10:00:00Z",
};
const owner = {
  email: "dana@coral-cove.demo.invalid",
  role: "owner",
  status: "active",
  deleted_at: null,
};
function reader(shops = [shop], accounts = [owner]) {
  return {
    query: vi.fn().mockResolvedValueOnce({ rows: shops }).mockResolvedValueOnce({ rows: accounts }),
  };
}

describe("operator demo lookup", () => {
  it("requires exact explicit selection for credentials", () => {
    expect(parseDemoAccessArgs(["credentials", "--slug", "coral-cove"]).slug).toBe("coral-cove");
    for (const args of [
      ["credentials"],
      ["credentials", "--query", "coral"],
      ["credentials", "--slug", "coral", "--since", "2026-11-09T00:00:00Z"],
      ["credentials", "--slug", "x' or true--"],
      ["list", "--unknown", "x"],
      ["list", "--since", "yesterday"],
      ["list", "--query", "a", "--query", "b"],
    ])
      expect(() => parseDemoAccessArgs(args)).toThrow();
  });

  it("accepts bounded lookup filters and UTC time", () => {
    expect(
      parseDemoAccessArgs(["list", "--query", "coral", "--since", "2026-11-09T00:00:00Z"]),
    ).toMatchObject({ query: "coral", since: "2026-11-09T00:00:00Z" });
    expect(() => parseDemoAccessArgs(["list", "--query", "x".repeat(101)])).toThrow();
  });

  it("does literal, parameterized demo-only lookup without emitting emails", async () => {
    const db = reader();
    expect(await listDemos(db, "%_';drop", null)).toEqual([shop]);
    const [sql, parameters] = db.query.mock.calls[0];
    expect(sql).toContain("is_demo = true");
    expect(sql).toContain("limit 100");
    expect(sql).not.toContain("%_';drop");
    expect(sql).not.toContain("email");
    expect(parameters).toEqual(["%_';drop", null]);
  });

  it("returns the existing sample owner login only for a matching demo", async () => {
    const db = reader();
    expect(await demoCredentials(db, shop.slug)).toMatchObject({
      email: owner.email,
      password: "password",
    });
    expect(db.query.mock.calls[0][0]).toContain("is_demo = true and slug = $1");
    expect(db.query.mock.calls[1][1]).toEqual([shop.id]);
  });

  it("does not even read accounts for real, expired or missing shops", async () => {
    const db = reader([]);
    expect(await demoCredentials(db, "real-shop")).toBeNull();
    expect(db.query).toHaveBeenCalledTimes(1);
  });

  it.each(
    [
      [],
      [{ ...owner, email: "owner@real.example" }],
      [{ ...owner, email: "owner@demo.invalid.attacker.example" }],
      [{ ...owner, status: "disabled" }],
      [{ ...owner, deleted_at: "2026-11-09" }],
      [{ ...owner, role: "captain" }],
      [owner, { ...owner, email: "other@demo.invalid" }],
      [owner, { ...owner, role: "captain", email: "captain@real.example" }],
    ].map((accounts) => [accounts]),
  )("refuses ambiguous, disabled or real-account demo identities %#", async (accounts) => {
    expect(await demoCredentials(reader([shop], accounts), shop.slug)).toBeNull();
  });
});

it("executes the read-only lookup against Postgres semantics", async () => {
  const pg = new PGlite();
  try {
    await pg.exec(`create table shops (id text, slug text, name text, created_at timestamptz, is_demo boolean);
      create table people (id text, shop_id text, deleted_at timestamptz);
      create table person_roles (person_id text, role text);
      create table user_accounts (person_id text, email text, status text);
      insert into shops values ('demo','coral-cove','Coral Cove','2026-11-09T10:00:00Z',true),('real','real-shop','Real Shop','2026-11-09T11:00:00Z',false);
      insert into people values ('demo-owner','demo',null),('real-owner','real',null);
      insert into person_roles values ('demo-owner','owner'),('real-owner','owner');
      insert into user_accounts values ('demo-owner','dana@coral-cove.demo.invalid','active'),('real-owner','owner@real.example','active');`);
    const db = { query: (sql, args) => pg.query(sql, args) };
    await pg.exec("begin transaction isolation level repeatable read read only");
    expect((await listDemos(db, "coral", "2026-11-09T09:00:00Z")).map((x) => x.slug)).toEqual([
      "coral-cove",
    ]);
    expect(await listDemos(db, "%", null)).toEqual([]);
    expect(await demoCredentials(db, "real-shop")).toBeNull();
    expect(await demoCredentials(db, "coral-cove")).toMatchObject({
      email: "dana@coral-cove.demo.invalid",
    });
    await pg.exec("rollback");
    await pg.exec("update shops set is_demo = true where id = 'real'");
    expect(await demoCredentials(db, "real-shop")).toBeNull();
  } finally {
    await pg.close();
  }
});
