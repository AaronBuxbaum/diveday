import { and, eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { listDiverMergeCandidates } from "@/db/diver-merge";
import { people } from "@/db/schema";
import { nowDate } from "@/lib/clock";
import { seededShopContext } from "@/test/db";
import { mergeCandidatesState } from "./merge-candidates-state";

it("creates eight ranked duplicate candidates only when the gated trouble route asks", async () => {
  const { db, shop } = await seededShopContext();
  const now = nowDate();
  const calm = await mergeCandidatesState(
    new Request("http://localhost/api/test/seed-trouble-states?boatSafety=1"),
    db,
    shop.id,
    now,
  );
  expect(calm).toEqual({});
  expect(
    await db
      .select()
      .from(people)
      .where(and(eq(people.shopId, shop.id), eq(people.fullName, "Mara Duplicate Record"))),
  ).toHaveLength(0);

  const seeded = await mergeCandidatesState(
    new Request("http://localhost/api/test/seed-trouble-states?mergeCandidates=1"),
    db,
    shop.id,
    now,
  );
  if (!seeded.mergeCandidates) throw new Error("merge candidates were not made");
  const { sourceId } = seeded.mergeCandidates;
  const candidates = await listDiverMergeCandidates(db, shop.id, sourceId);
  expect(candidates.map((candidate) => candidate.fullName)).toEqual(
    Array.from({ length: 8 }, (_, index) => `Mara Duplicate ${String(index + 1).padStart(2, "0")}`),
  );
  expect(candidates.map((candidate) => candidate.id)).toEqual(seeded.mergeCandidates.candidateIds);
  expect(candidates.every((candidate) => candidate.reasons.join() === "same_phone")).toBe(true);
});
