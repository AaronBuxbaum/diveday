// @vitest-environment node
import { and, eq, isNull } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { displayStoredPhone } from "@/lib/forgiving-fields";
import { seededShopContext } from "@/test/db";
import type { AppDb } from "./client";
import { personSearchMatch } from "./person-search";
import { people } from "./schema";

/**
 * **The predicate every staff search box runs, tested where it lives.**
 *
 * The screen and the column hold different strings — E.164 in the row
 * (`phoneForStorage`), a grouped reading on the surface (`displayStoredPhone`)
 * — so what a staffer copies is never what was stored. These cases are the
 * shapes a number arrives in at a counter, and every one of them must find the
 * row (issue #1765).
 */
describe("personSearchMatch", () => {
  async function seatedDiver(db: AppDb, shopId: string, fullName: string, phone: string) {
    const [person] = await db.insert(people).values({ shopId, fullName, phone }).returning();
    if (!person) throw new Error("person insert returned no row");
    return person;
  }

  async function matches(db: AppDb, shopId: string, query: string) {
    const rows = await db
      .select({ id: people.id })
      .from(people)
      .where(and(eq(people.shopId, shopId), isNull(people.deletedAt), personSearchMatch(query)));
    return rows.map((row) => row.id);
  }

  it("finds an E.164 row from the grouped number printed on the screen", async () => {
    const { db, shop } = await seededShopContext();
    const stored = "+13055550654";
    const person = await seatedDiver(db, shop.id, "Paste Case", stored);

    // Not a hand-written expectation: this is literally what the diver header,
    // the counter row and the merge screen put on screen for this row, which is
    // what a staffer selects and pastes.
    const onScreen = displayStoredPhone(stored);
    expect(onScreen).toBe("+1 305 555 0654");
    expect(await matches(db, shop.id, onScreen)).toContain(person.id);
  });

  it("finds the same row from the shapes a staffer types instead of pasting", async () => {
    const { db, shop } = await seededShopContext();
    const person = await seatedDiver(db, shop.id, "Typed Case", "+13055550655");

    // Off a handwritten card or a caller ID — no calling code to type, and
    // DiveDay never asks for one. Deliberate, not luck: see the docblock.
    expect(await matches(db, shop.id, "305 555 0655")).toContain(person.id);
    expect(await matches(db, shop.id, "305-555-0655")).toContain(person.id);
    expect(await matches(db, shop.id, "(305) 555-0655")).toContain(person.id);
    // The stored string itself, for a staffer who got it from an export.
    expect(await matches(db, shop.id, "+13055550655")).toContain(person.id);
  });

  /**
   * The half a needle-side strip alone cannot reach. `people.phone` is allowed
   * to hold text no writer could resolve — an extension, a number a CSV carried
   * in dashes — and `13055550656` is not a substring of `+1 305 555 0656 x21`.
   * Only the stored-side `regexp_replace` finds it.
   */
  it("finds a row whose stored value was never E.164 at all", async () => {
    const { db, shop } = await seededShopContext();
    const person = await seatedDiver(db, shop.id, "Extension Case", "+1 305 555 0656 x21");
    // The screen shows this one exactly as stored, so proving the search finds
    // it proves the column side is doing the work.
    expect(displayStoredPhone("+1 305 555 0656 x21")).toBe("+1 305 555 0656 x21");

    expect(await matches(db, shop.id, "+13055550656")).toContain(person.id);
    expect(await matches(db, shop.id, "3055550656")).toContain(person.id);
    // And the non-digit part of the stored value stays reachable as typed,
    // which is the raw `ilike` arm earning its place beside the digits one.
    expect(await matches(db, shop.id, "x21")).toContain(person.id);
  });

  it("matches name and email as before, and nothing on an empty query", async () => {
    const { db, shop } = await seededShopContext();
    const [person] = await db
      .insert(people)
      .values({ shopId: shop.id, fullName: "Priya Namesake", email: "namesake@example.com" })
      .returning();
    if (!person) throw new Error("person insert returned no row");

    expect(await matches(db, shop.id, "namesake")).toContain(person.id);
    expect(await matches(db, shop.id, "NAMESAKE@example")).toContain(person.id);
    // Undefined, not a predicate that matches everything: the callers compose
    // this into an `and(...)`, where a blank query must add no clause at all.
    expect(personSearchMatch("   ")).toBeUndefined();
  });

  /**
   * The digit floor, from both sides. `7766` can only be answered digit-wise —
   * the dash in the stored value is in the way of the raw `ilike` — so a match
   * proves the digits arm is on, and a miss one digit shorter proves it is off.
   */
  it("compares digits only once the query carries enough of them", async () => {
    const { db, shop } = await seededShopContext();
    const person = await seatedDiver(db, shop.id, "Floor Case", "+1 (999) 888-7766");

    expect(await matches(db, shop.id, "8877")).toContain(person.id);
    expect(await matches(db, shop.id, "877")).not.toContain(person.id);
  });
});
