import type { AppDb } from "@/db/client";
import { people, personRoles } from "@/db/schema";
import { boatSliceStates } from "./boat-states";
import { manifestOverCapacityState } from "./manifest-overcapacity-state";

/** Opt-in fixture, reached only after the trouble route's secret and demo-shop gates. */
export async function mergeCandidatesState(
  request: Request,
  db: AppDb,
  shopId: string,
  now: Date,
): Promise<{ mergeCandidates?: { sourceId: string; candidateIds: string[] } }> {
  if (new URL(request.url).searchParams.get("mergeCandidates") !== "1") return {};

  return db.transaction(async (tx) => {
    const records = await tx
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
    return {
      mergeCandidates: { sourceId: source.id, candidateIds: candidates.map(({ id }) => id) },
    };
  });
}

/** Supplementary opt-in fixtures keep the route's response assembly bounded. */
export async function boatAndMergeStates(request: Request, db: AppDb, shopId: string, now: Date) {
  return {
    ...(await boatSliceStates(request, db, shopId, now)),
    ...(await mergeCandidatesState(request, db, shopId, now)),
    ...(await manifestOverCapacityState(request, db, shopId, now)),
  };
}
