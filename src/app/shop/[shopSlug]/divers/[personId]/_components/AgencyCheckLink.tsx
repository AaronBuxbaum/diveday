import type { CertificationAgency } from "@/db/schema";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { agencyVerificationUrl } from "@/lib/agency-verification";
import { AGENCY_KEYS } from "./shared";

/**
 * "Check with SSI": the agency's own public verification page, in a new tab,
 * beside a card that is waiting for somebody to confirm it. A link and nothing
 * more (H-10): DiveDay never calls the agency, and the staffer still marks the
 * card certified here once the agency's page agrees. Renders nothing for an
 * agency with no public lookup (`src/lib/agency-verification.ts`).
 */
export function AgencyCheckLink({
  agency,
  t,
}: {
  agency: CertificationAgency;
  t: StaffTranslator;
}) {
  const url = agencyVerificationUrl(agency);
  if (!url) return null;
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="mt-1 block w-fit text-sm font-semibold text-primary hover:underline print:hidden"
    >
      {t("divers.certifications.checkWithAgency", { agency: t(AGENCY_KEYS[agency]) })}
    </a>
  );
}
