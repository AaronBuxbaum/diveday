import { and, eq } from "drizzle-orm";
import type { AppDb } from "@/db/client";
import { people, rentalFitProfiles } from "@/db/schema";

/**
 * **A fit that asks for a piece the shop's catalog does not offer** (issue
 * #1805) — the packing line that reads "You no longer rent this", and the
 * `(shop no longer rents this)` marker its rail-side twin carries.
 *
 * A stored `rents_*` flag survives the shop dropping that item (#1755): the
 * diver's answer was theirs, and a catalog edit is not the diver speaking. So
 * the piece is kept and *marked* rather than filtered out — a silent drop
 * would hide a fit nobody can fill. Nothing had ever rendered that, because no
 * seeded diver was in the state.
 *
 * **One flag, no catalog edit.** The demo's `rentalItems` already lists no
 * torch, so ticking `rents_torch` on one existing fit reaches the state
 * without touching the catalog — which matters, because editing the catalog
 * would move every other diver's packing line. Un-ticking a kind the demo
 * does rent is not an option either, for the same reason.
 *
 * **Not seeded into blue-mantis**, which is the rule this route exists for
 * (`.claude/rules/e2e.md`, `.claude/rules/db.md`). The reach is the argument:
 * `rentalFitLine` (`src/lib/dive-prep.ts`) feeds the roll call, the offline
 * manifest and the diver record from these same pieces, so a demo carrying
 * this standing would print an oddity nobody can clear on the boat manifest,
 * and a marker a crew meets every morning is a marker they stop reading.
 *
 * The diver is June Park: she is on the demo's next reef departure, where the
 * prep captures look, and no other seed or spec reads her sizes — her buddy
 * team and her nitrox card are what she is named for elsewhere, and neither
 * touches this.
 */
export async function askForAPieceTheShopNoLongerRents(
  db: AppDb,
  shopId: string,
): Promise<{ fullName: string; kind: "torch" } | null> {
  const fullName = "June Park";
  const [diver] = await db
    .select({ id: people.id })
    .from(people) // diveday:allow-deleted-people: an e2e seed finds the people it just seeded
    .where(and(eq(people.shopId, shopId), eq(people.fullName, fullName)))
    .limit(1);
  if (!diver) return null;
  const updated = await db
    .update(rentalFitProfiles)
    .set({ rentsTorch: true })
    .where(
      and(
        eq(rentalFitProfiles.shopId, shopId),
        // Only a fit that already exists — the `returning()` below is what
        // says so. A diver with no row has not been asked, which is a
        // different state this must not manufacture by inserting one.
        eq(rentalFitProfiles.personId, diver.id),
      ),
    )
    .returning({ id: rentalFitProfiles.id });
  if (updated.length === 0) return null;
  return { fullName, kind: "torch" };
}
