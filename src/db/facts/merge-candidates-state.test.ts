import { and, eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { listDiverMergeCandidates } from "@/db/diver-merge";
import { people } from "@/db/schema";
import { nowDate } from "@/lib/clock";
import { seededShopContext } from "@/test/db";
import { applyFacts } from "./index";

it("creates eight ranked duplicate candidates only when the fact is named", async () => {
  const { db, shop } = await seededShopContext();
  const now = nowDate();
  const context = { db, shop, actorId: "", now };
  const calm = await applyFacts([], context);
  expect(calm).toEqual({});
  expect(
    await db
      .select()
      .from(people)
      .where(and(eq(people.shopId, shop.id), eq(people.fullName, "Mara Duplicate Record"))),
  ).toHaveLength(0);

  const seeded = await applyFacts(["mergeCandidates"], context);
  const made = seeded.mergeCandidates as { sourceId: string; candidateIds: string[] } | undefined;
  if (!made) throw new Error("merge candidates were not made");
  const { sourceId } = made;
  const candidates = await listDiverMergeCandidates(db, shop.id, sourceId);
  expect(candidates.map((candidate) => candidate.fullName)).toEqual(
    Array.from({ length: 8 }, (_, index) => `Mara Duplicate ${String(index + 1).padStart(2, "0")}`),
  );
  expect(candidates.map((candidate) => candidate.id)).toEqual(made.candidateIds);
  expect(candidates.every((candidate) => candidate.reasons.join() === "same_phone")).toBe(true);
});
