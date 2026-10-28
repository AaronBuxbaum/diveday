import { eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { fileScopedShopContext } from "@/test/db";
import { charterContext } from "@/test/training-mark-context";
import { loadDiverExportBundleInput } from "./export";
import { bookings, people } from "./schema";

const ctx = fileScopedShopContext();

it("includes the student's plan and staff names without exporting another diver's identity", async () => {
  const f = await charterContext(ctx);
  const [instructor] = await f.db.select().from(people).where(eq(people.id, f.instructor));
  const [owner] = await f.db.select().from(people).where(eq(people.id, f.owner));
  if (!instructor || !owner) throw new Error("staff missing");
  const at = new Date("2026-10-01T12:00:00Z");
  await f.db
    .update(bookings)
    .set({
      trainingPlanInstructorPersonId: instructor.id,
      trainingPlanByPersonId: owner.id,
      trainingPlanAt: at,
    })
    .where(eq(bookings.id, f.seat.id));
  const exportRow = async () => {
    const bundle = await loadDiverExportBundleInput(f.db, f.shop.id, f.seat.personId);
    const table = bundle?.tables.find((entry) => entry.file === "bookings.csv");
    if (!table) throw new Error("bookings missing");
    const id = table.header.indexOf("id");
    const row = table.rows.find((entry) => entry[id] === f.seat.id);
    if (!row) throw new Error("seat missing");
    return { table, row };
  };
  const { table, row } = await exportRow();
  expect(row[table.header.indexOf("training_plan_instructor_name")]).toBe(instructor.fullName);
  expect(row[table.header.indexOf("training_plan_by_name")]).toBe(owner.fullName);
  expect(row[table.header.indexOf("training_plan_at")]).toEqual(at);
  expect(table.header).not.toContain("training_plan_instructor_person_id");
  const [other] = await f.db
    .insert(people)
    .values({ shopId: f.shop.id, fullName: "Private other diver" })
    .returning();
  if (!other) throw new Error("other missing");
  await f.db
    .update(bookings)
    .set({ trainingPlanInstructorPersonId: other.id })
    .where(eq(bookings.id, f.seat.id));
  const unsafe = await exportRow();
  expect(JSON.stringify(unsafe)).not.toContain(other.fullName);
});
