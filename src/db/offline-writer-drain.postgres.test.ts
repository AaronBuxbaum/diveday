import { randomBytes } from "node:crypto";
import { Client } from "pg";
import { expect, it } from "vitest";
import { describePostgres, postgresTestDb } from "@/test/postgres";

/**
 * A disposable-cluster demonstration of PostgreSQL primitives, not a Neon or
 * Vercel cutover test. Role names and the database are unique to this test.
 */
describePostgres("offline writer drain primitives", () => {
  it("rejects new old-writer logins and rolls back an old in-flight transaction before admitting the new writer", async () => {
    const scratch = await postgresTestDb();
    const suffix = randomBytes(8).toString("hex");
    const oldRole = `dd_old_${suffix}`;
    const newRole = `dd_new_${suffix}`;
    const password = randomBytes(24).toString("hex");
    const admin = new Client({ connectionString: scratch.url });
    await admin.connect();
    let old: Client | undefined;
    let idle: Client | undefined;
    let fresh: Client | undefined;
    const created: string[] = [];
    try {
      const { rows } = await admin.query<{ name: string }>("select current_database() as name");
      const database = rows[0].name;
      // A scratch database name is created by postgresTestDb, never user input.
      const quotedDb = `"${database.replaceAll('"', '""')}"`;
      await admin.query(
        `create role ${oldRole} login password '${password}' nosuperuser nocreatedb nocreaterole noinherit`,
      );
      created.push(oldRole);
      await admin.query(
        `create role ${newRole} nologin password '${password}' nosuperuser nocreatedb nocreaterole noinherit`,
      );
      created.push(newRole);
      await admin.query(`revoke connect on database ${quotedDb} from public`);
      await admin.query(`grant connect on database ${quotedDb} to ${oldRole}, ${newRole}`);
      await admin.query("create table public.drain_sentinel (id text primary key)");
      await admin.query(`grant usage on schema public to ${oldRole}, ${newRole}`);
      await admin.query(`grant select, insert on public.drain_sentinel to ${oldRole}, ${newRole}`);
      const connection = (role: string) => {
        const url = new URL(scratch.url);
        url.username = role;
        url.password = password;
        return new Client({ connectionString: url.toString() });
      };
      old = connection(oldRole);
      idle = connection(oldRole);
      // A server-terminated client emits an error as well as ending its session.
      old.on("error", () => {});
      idle.on("error", () => {});
      await old.connect();
      await idle.connect();
      await old.query("insert into public.drain_sentinel values ('already-committed')");
      await old.query("begin");
      await old.query("insert into public.drain_sentinel values ('uncommitted')");
      await admin.query(`alter role ${oldRole} nologin`);
      const rejected = connection(oldRole);
      await expect(rejected.connect()).rejects.toThrow();
      await rejected.end().catch(() => {});
      const before = await admin.query<{ count: string }>(
        "select count(*) from pg_stat_activity where usename = $1",
        [oldRole],
      );
      expect(Number(before.rows[0].count)).toBe(2);
      // Do not admit the replacement while any old session remains.
      const closed = connection(newRole);
      await expect(closed.connect()).rejects.toThrow();
      await closed.end().catch(() => {});
      const ended = Promise.all([
        new Promise<void>((resolve) => old?.once("end", resolve)),
        new Promise<void>((resolve) => idle?.once("end", resolve)),
      ]);
      await admin.query(
        "select pg_terminate_backend(pid) from pg_stat_activity where usename = $1",
        [oldRole],
      );
      await ended;
      const after = await admin.query<{ count: string }>(
        "select count(*) from pg_stat_activity where usename = $1",
        [oldRole],
      );
      expect(Number(after.rows[0].count)).toBe(0);
      const sentinel = await admin.query<{ id: string }>(
        "select id from public.drain_sentinel order by id",
      );
      expect(sentinel.rows).toEqual([{ id: "already-committed" }]);
      await admin.query(`alter role ${newRole} login`);
      fresh = connection(newRole);
      await fresh.connect();
      await fresh.query("insert into public.drain_sentinel values ('new-writer')");
      expect((await admin.query("select id from public.drain_sentinel order by id")).rows).toEqual([
        { id: "already-committed" },
        { id: "new-writer" },
      ]);
    } finally {
      await Promise.all([
        old?.end().catch(() => {}),
        idle?.end().catch(() => {}),
        fresh?.end().catch(() => {}),
      ]);
      for (const role of created) {
        await admin.query(`drop owned by ${role}`);
        await admin.query(`drop role ${role}`);
      }
      await admin.end();
    }
  });
});
