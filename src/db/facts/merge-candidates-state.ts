import type { AppDb } from "@/db/client";
import { people, personRoles } from "@/db/schema";

/** Nine divers who share a phone number, so the merge panel has a source and eight candidates. */
export async function mergeCandidatesState(
  db: AppDb,
  shopId: string,
  now: Date,
): Promise<{ sourceId: string; candidateIds: string[] }> {
  return db.transaction(async (tx) => {
    const records = await tx
      // diveday:allow-person-insert: duplicate-looking fixture rows the merge panel ranks, with roles written below
      .insert(people)
      .values([
        {
          shopId,
          fullName: "Mara Duplicate Record",
          email: "merge.source@example.test",
          phone: "+12025550196",
          createdAt: now,
        },
        ...Array.from({ length: 8 }, (_, index) => ({
          shopId,
          fullName: `Mara Duplicate ${String(index + 1).padStart(2, "0")}`,
          email: `merge.candidate.${index + 1}@example.test`,
          phone: "+12025550196",
          createdAt: now,
        })),
      ])
      .returning({ id: people.id });
    const [source, ...candidates] = records;
    if (!source || candidates.length !== 8) throw new Error("merge candidate fixture incomplete");
    await tx
      .insert(personRoles)
      .values(records.map(({ id }) => ({ personId: id, role: "diver" as const })));
    return { sourceId: source.id, candidateIds: candidates.map(({ id }) => id) };
  });
}
