import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { seededShopContext } from "@/test/db";

describe("seed audit probe", () => {
  it("profiles the seeded shop", async () => {
    const { db } = await seededShopContext({ history: true });
    const q = async (label: string, text: string) => {
      const res = await db.execute(sql.raw(text));
      const rows = (Array.isArray(res) ? res : (res.rows ?? [])) as Record<string, unknown>[];
      return `--- ${label}\n${rows.map((r) => JSON.stringify(r)).join("\n")}`;
    };
    const out = [
      await q("order status", `select status, count(*)::int n from orders group by 1 order by 1`),
      await q(
        "order line kinds",
        `select kind, count(*)::int n from order_line_items group by 1 order by 1`,
      ),
      await q(
        "orders partially paid",
        `select count(*)::int n from orders where amount_paid_cents > 0 and amount_paid_cents < total_cents`,
      ),
      await q(
        "orders standalone (no booking)",
        `select count(*)::int n from orders where booking_id is null`,
      ),
      await q(
        "waiver records by status/sealed",
        `select status, (integrity_hash is not null) sealed, count(*)::int n from waiver_records group by 1,2 order by 1,2`,
      ),
      await q(
        "waiver signed_at distinct days",
        `select count(distinct date_trunc('day', signed_at))::int days, min(signed_at) mn, max(signed_at) mx from waiver_records where signed_at is not null`,
      ),
      await q(
        "waiver signed_at newest 25 (what the signatures tab page 1 shows)",
        `select to_char(signed_at,'YYYY-MM-DD') d, (integrity_hash is not null) sealed, count(*)::int n from waiver_records where status in ('completed','medical_review') group by 1,2 order by 1 desc limit 25`,
      ),
      await q(
        "trip_reviews",
        `select is_published, count(*)::int n, min(rating) mn, max(rating) mx from trip_reviews group by 1 order by 1`,
      ),
      await q(
        "notification deliveries",
        `select channel, status, count(*)::int n from notification_deliveries group by 1,2 order by 1,2`,
      ),
      await q(
        "trips by status",
        `select status, count(*)::int n from trips group by 1 order by 1`,
      ),
      await q("dive_sites", `select name, is_active from dive_sites order by name`),
      await q(
        "global_dive_sites",
        `select name, region from global_dive_sites order by name`,
      ),
      await q("staff_shifts", `select count(*)::int n from staff_shifts`),
      await q(
        "bookings by status",
        `select status, count(*)::int n from bookings group by 1 order by 1`,
      ),
      await q("courses", `select title, status from courses order by title`),
    ];
    console.log(`\nSEED-PROFILE\n${out.join("\n")}\n`);
    expect(true).toBe(true);
  });
});
