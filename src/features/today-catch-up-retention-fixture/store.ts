import type { AppDb } from "../../db/client";
import { todayReadMarks } from "../../db/schema/index";

/** A retention fixture with a distinct day and staff member per sample. */
export async function writeTodayReadMark(
  { db, shop, people }: { db: AppDb; shop: { id: string }; people: string[] },
  at: Date,
  n: number,
): Promise<string> {
  const [row] = await db
    .insert(todayReadMarks)
    .values({ shopId: shop.id, personId: people[n], dayStart: at, lastSeenAt: at })
    .returning({ id: todayReadMarks.id });
  if (!row) throw new Error("Today read mark fixture was not inserted");
  return row.id;
}
