import { describe, expect, it, vi } from "vitest";
import { migrateRestoredDatabase } from "./restore-drill-migrate.ts";

const { migrate, drizzle } = vi.hoisted(() => ({ migrate: vi.fn(), drizzle: vi.fn() }));
vi.mock("drizzle-orm/node-postgres/migrator", () => ({ migrate }));
vi.mock("drizzle-orm/node-postgres", () => ({ drizzle }));

function target(ready = true, present = true) {
  const client = {
    query: vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ ready }] })
      .mockResolvedValueOnce({ rows: [{ present }] })
      .mockResolvedValue({ rows: [] }),
    release: vi.fn(),
  };
  return { client, pool: { connect: vi.fn().mockResolvedValue(client) } };
}

describe("restored database schema alignment", () => {
  it("applies committed migrations on the validated connection, with public search_path", async () => {
    const { client, pool } = target();
    const db = {};
    drizzle.mockReturnValue(db);
    await migrateRestoredDatabase(pool);
    expect(client.query.mock.calls[0][0]).toContain("current_database() = 'restore_drill'");
    expect(client.query.mock.calls[0][0]).toContain("drizzle.__drizzle_migrations");
    expect(client.query).toHaveBeenLastCalledWith("set search_path to public");
    expect(drizzle).toHaveBeenCalledWith({ client });
    expect(migrate).toHaveBeenCalledWith(db, { migrationsFolder: "drizzle" });
    expect(client.release).toHaveBeenCalledOnce();
  });

  it.each([
    [false, true],
    [true, false],
  ])("refuses a wrong/partial restore (%s, %s) without DDL", async (ready, present) => {
    migrate.mockClear();
    const { client, pool } = target(ready, present);
    await expect(migrateRestoredDatabase(pool)).rejects.toThrow();
    expect(migrate).not.toHaveBeenCalled();
    expect(client.query).not.toHaveBeenCalledWith("set search_path to public");
    expect(client.release).toHaveBeenCalledOnce();
  });

  it("propagates migration failure and releases the connection, rather than proceeding to verify", async () => {
    const { client, pool } = target();
    migrate.mockRejectedValueOnce(new Error("migration failed"));
    await expect(migrateRestoredDatabase(pool)).rejects.toThrow("migration failed");
    expect(client.release).toHaveBeenCalledOnce();
  });
});
