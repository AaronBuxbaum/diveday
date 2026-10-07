import type { CertificationAgency } from "@/db/schema";
import type { StaffMessageKey, StaffTranslator } from "@/i18n/staff-messages";
import { type AgencyVerificationPage, agencyVerificationPage } from "@/lib/agency-verification";
import { AGENCY_KEYS } from "./shared";

/**
 * "Check with SSI": the agency's own public verification page, in a new tab,
 * beside a card that is waiting for somebody to confirm it. A link and nothing
 * more (H-10): DiveDay never calls the agency, and the staffer still marks the
 * card certified here once the agency's page agrees. Renders nothing for an
 * agency with no lookup (`src/lib/agency-verification.ts`). The words say what
 * the far side is: a portal with gaps is "searched", and a member sign-in is
 * named before the staffer meets the login form.
 */
const LINK_KEYS: Record<AgencyVerificationPage["kind"], StaffMessageKey> = {
  check: "divers.certifications.checkWithAgency",
  search_portal: "divers.certifications.searchAgencyPortal",
  member_sign_in: "divers.certifications.checkWithAgencyMemberSignIn",
};

export function AgencyCheckLink({
  agency,
  t,
}: {
  agency: CertificationAgency;
  t: StaffTranslator;
}) {
  const page = agencyVerificationPage(agency);
  if (!page) return null;
  return (
    <a
      href={page.url}
      target="_blank"
      rel="noopener noreferrer"
      className="mt-1 block w-fit text-sm font-semibold text-primary hover:underline print:hidden"
    >
      {t(LINK_KEYS[page.kind], { agency: t(AGENCY_KEYS[agency]) })}
    </a>
  );
}
