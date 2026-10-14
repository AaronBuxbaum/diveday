import {
  agencyCheckCopy,
  agencyLinkLabel,
} from "@/app/shop/[shopSlug]/_components/agency-check/agency-check-copy";
import type { CertificationAgency } from "@/db/schema";
import type { StaffTranslator } from "@/i18n/staff-messages";
import type { AgencyCheckQuery } from "@/lib/agency-check";
import type { AgencyCheckResult } from "../card-actions";
import { AgencyCheck } from "./AgencyCheck";

/**
 * "Check with SSI": the agency's own public verification page, in a new tab,
 * beside a card that is waiting for somebody to confirm it. DiveDay's servers
 * never call the agency (H-10). Renders nothing for an agency with no lookup
 * (`src/lib/agency-verification.ts`). The words say what the far side is
 * (`agencyLinkLabel`): a portal with gaps is "searched", and a member sign-in
 * is named before the staffer meets the login form.
 *
 * A level card passes `check`, and then the same words become a button when
 * the DiveDay browser extension is in this browser: the extension reads the
 * agency's page from the staffer's own browser and a match certifies the card
 * (H-105, `AgencyCheck`). Without the extension it is still this link.
 */
export function AgencyCheckLink({
  agency,
  t,
  check,
}: {
  agency: CertificationAgency;
  t: StaffTranslator;
  check?: {
    certificationId: string;
    awaiting: boolean;
    query: AgencyCheckQuery | null;
    action: (previous: AgencyCheckResult, formData: FormData) => Promise<AgencyCheckResult>;
  };
}) {
  const link = agencyLinkLabel(t, agency);
  if (!link) return null;
  if (!check) {
    return (
      <a
        href={link.href}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-1 block w-fit text-sm font-semibold text-primary hover:underline print:hidden"
      >
        {link.label}
      </a>
    );
  }
  return (
    <AgencyCheck
      href={link.href}
      query={check.query}
      certificationId={check.certificationId}
      awaiting={check.awaiting}
      action={check.action}
      copy={agencyCheckCopy(t, agency, link.label)}
    />
  );
}
