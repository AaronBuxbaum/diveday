import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { rows } from "@/db/catalog";
import { unseededTestDb } from "@/test/db";
import { mintDemoShop } from "./store";

type Db = Awaited<ReturnType<typeof unseededTestDb>>;

/** One mint the way the action runs it: the copy, if one is due, is taken after it returns. */
async function mint(db: Db, phases: string[]) {
  const deferred: Promise<void>[] = [];
  const minted = await mintDemoShop(db, {
    onTiming: (phase) => phases.push(phase),
    defer: (work) => deferred.push(work()),
  });
  await Promise.all(deferred);
  return minted;
}

async function ownedByTable(db: Awaited<ReturnType<typeof unseededTestDb>>, slug: string) {
  const tables = await rows<{ name: string }>(
    db,
    sql`select table_name as name from information_schema.columns
        where table_schema = 'public' and column_name = 'shop_id' order by 1`,
  );
  const [shop] = await rows<{ id: string }>(db, sql`select id from shops where slug = ${slug}`);
  const counts: Record<string, number> = {};
  for (const { name } of tables) {
    const [row] = await rows<{ n: string }>(
      db,
      sql.raw(`select count(*) as n from "${name}" where shop_id = '${shop?.id}'`),
    );
    if (Number(row?.n) > 0) counts[name] = Number(row?.n);
  }
  return { id: shop?.id as string, counts };
}

describe("mintDemoShop", () => {
  it("writes the second shop from a copy of the first, owning exactly what the first owns", async () => {
    const db = await unseededTestDb();
    const phases: string[] = [];
    const first = await mint(db, phases);
    const second = await mint(db, phases);

    // The first was built for real, the second written from its copy.
    expect(phases).toContain("mint.schedule");
    expect(phases.at(-1)).toBe("mint.clone");

    expect(second.slug).not.toBe(first.slug);
    expect(second.ownerEmail).toBe(`dana@${second.slug}.demo.invalid`);
    const a = await ownedByTable(db, first.slug);
    const b = await ownedByTable(db, second.slug);
    expect(b.counts).toEqual(a.counts);
    expect(Object.keys(b.counts).length).toBeGreaterThan(20);

    // Nothing of the first shop leaks into the second: no shared row, no old name.
    const [shared] = await rows<{ n: string }>(
      db,
      sql`select count(*) as n from people p1 join people p2 on p1.id = p2.id and p1.shop_id <> p2.shop_id`,
    );
    expect(Number(shared?.n)).toBe(0);
    const [stale] = await rows<{ n: string }>(
      db,
      sql`select count(*) as n from people where shop_id = ${b.id} and email like ${`%${first.slug}%`}`,
    );
    expect(Number(stale?.n)).toBe(0);
  });

  it("serves a third and fourth mint, each with its own cast", async () => {
    const db = await unseededTestDb();
    const slugs = new Set<string>();
    const phases: string[] = [];
    for (let i = 0; i < 4; i += 1) {
      slugs.add((await mint(db, phases)).slug);
    }
    expect(phases.filter((phase) => phase === "mint.clone")).toHaveLength(3);
    expect(slugs.size).toBe(4);
    const [people] = await rows<{ n: string }>(
      db,
      sql`select count(distinct email) as n from user_accounts`,
    );
    expect(Number(people?.n)).toBeGreaterThanOrEqual(4 * 3);
  });
});
