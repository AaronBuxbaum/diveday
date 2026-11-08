import { findSimilarDivers } from "@/features/divers";
import { readFormDraft } from "@/features/form-drafts";
import type { AppDb } from "../../db/client";

/**
 * **The new-diver form's reads** (issue #2757): what this person had typed
 * here when they were last interrupted (ADR 20260906-before-you-ask, decision
 * 3); the divers a name being confirmed reads like; and, for a walk-in party
 * the on-file check stopped, who each stopped row reads like (rows with no
 * match dropped).
 */
export async function getNewDiverPage(
  db: AppDb,
  shopId: string,
  personId: string,
  input: {
    confirmName?: string;
    onFile: readonly { row: number; typedName: string }[];
  },
) {
  const [draft, potentialMatches, onFile] = await Promise.all([
    readFormDraft(db, shopId, personId, "new_diver"),
    input.confirmName ? findSimilarDivers(db, shopId, input.confirmName) : [],
    Promise.all(
      input.onFile.map(async (entry) => ({
        ...entry,
        matches: await findSimilarDivers(db, shopId, entry.typedName),
      })),
    ),
  ]);
  return {
    draft,
    potentialMatches,
    onFileRows: onFile.filter((entry) => entry.matches.length > 0),
  };
}
