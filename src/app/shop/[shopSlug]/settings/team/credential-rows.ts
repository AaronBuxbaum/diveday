import type { listStaffCredentials } from "@/db/staff-credentials";
import type { StaffTranslator } from "@/i18n/staff-messages";
import type { Role } from "@/lib/authz";
import { formatCalendarDate, shiftCalendarDate } from "@/lib/calendar-date";
import { CREDENTIAL_KIND_KEYS } from "./credential-kinds";

/** How far ahead a renewal counts as due soon. H-59: a word, never a gate. */
const RENEWAL_WINDOW_DAYS = 30;

/**
 * The roles that sail on a card: an instructor's or divemaster's rating, a
 * captain's license. A card for one of these with nothing recorded says so,
 * and one with a credential that does not answer the role names the missing
 * kind (`rolesMissingCredential`), because absence is what the Safety tab
 * cannot judge (third review, item 2; issue #2548).
 */
export const CREDENTIALED_ROLES: readonly Role[] = [
  "instructor",
  "assistant_instructor",
  "divemaster",
  "captain",
];

/** Where a credential's renewal date sits relative to the shop's own today. */
export type RenewalState = "not-recorded" | "current" | "due-soon" | "overdue";

/** One person's credential, as their own card reads it. */
export type CardCredential = {
  id: string;
  name: string;
  kind: string;
  /** The kind and the issuer, joined: "Captain’s license · USCG". */
  detail?: string;
  /** The renewal word, when the clock has something to say. Never colour alone. */
  renewalWord: string | null;
  renewal?: RenewalState;
  /** Somebody has looked at it; until then the card says "Needs review". */
  reviewed?: boolean;
};

/** Every credential, each renewal measured against the shop's own today. */
export function credentialRowsFor(
  credentials: Awaited<ReturnType<typeof listStaffCredentials>>,
  today: string,
  locale: string,
  t: StaffTranslator,
): (Required<CardCredential> & { personId: string })[] {
  const dueSoonThrough = shiftCalendarDate(today, RENEWAL_WINDOW_DAYS);
  return credentials.map(({ credential, person }) => {
    const renewal: RenewalState = !credential.renewsAt
      ? "not-recorded"
      : credential.renewsAt < today
        ? "overdue"
        : credential.renewsAt <= dueSoonThrough
          ? "due-soon"
          : "current";
    return {
      id: credential.id,
      personId: person.id,
      name: credential.name,
      kind: credential.kind,
      detail: [t(CREDENTIAL_KIND_KEYS[credential.kind]), credential.issuingBody]
        .filter(Boolean)
        .join(" · "),
      // The word is what carries the state; the ink only seconds it. A
      // credential whose renewal is comfortably ahead says the date and
      // nothing more, and one with no renewal recorded says nothing at all.
      renewalWord:
        renewal === "overdue"
          ? t("staffing.credentials.overdue")
          : renewal === "due-soon"
            ? t("staffing.credentials.dueSoon")
            : credential.renewsAt
              ? t("staffing.credentials.renews", {
                  date: formatCalendarDate(credential.renewsAt, locale),
                })
              : null,
      renewal,
      reviewed: credential.status === "verified",
    };
  });
}
