import type { StaffMember } from "@/db/staff-accounts";

/**
 * The name divers actually read for this person, or empty when they read none.
 *
 * **Both conditions, because this row makes a claim about a page it is not**
 * (issue #1357, tightened by a security pass on the commit that added it).
 * `tripPublicCrew` (`src/db/trips-record.ts`) requires the consent stamp, a
 * live person **and an `active` account** — so a divemaster who consented and
 * was later disabled vanishes from every public page while their roster row
 * went on saying "Divers see “Mar”". Disabling deliberately leaves the consent
 * standing (`setStaffAccountStatus` — a temporary disable should not destroy a
 * standing answer), which is right, and is exactly why the reader has to check
 * the second condition rather than infer it.
 *
 * `trim()` rather than truthiness for the same reason one layer down: the
 * check constraint pairs the stamp with a name that is non-blank **after
 * Postgres `btrim`**, which strips ASCII space and nothing else. No writer can
 * produce a tab-only name today — `crewPublicNameToStore` collapses every
 * `\p{Cc}` to a space and trims — but a roster is a poor place to learn that a
 * default changed.
 */
export function publicName(member: StaffMember): string {
  if (member.accountStatus !== "active") return "";
  return member.crewPublicName?.trim() ?? "";
}
