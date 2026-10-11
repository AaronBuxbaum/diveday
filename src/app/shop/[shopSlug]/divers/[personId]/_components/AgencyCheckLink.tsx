import type { CertificationAgency } from "@/db/schema";
import type { StaffMessageKey, StaffTranslator } from "@/i18n/staff-messages";
import type { AgencyCheckQuery } from "@/lib/agency-check";
import { type AgencyVerificationPage, agencyVerificationPage } from "@/lib/agency-verification";
import type { AgencyCheckResult } from "../card-actions";
import { AgencyCheck } from "./AgencyCheck";
import { AGENCY_KEYS } from "./shared";

/**
 * "Check with SSI": the agency's own public verification page, in a new tab,
 * beside a card that is waiting for somebody to confirm it. DiveDay's servers
 * never call the agency (H-10). Renders nothing for an agency with no lookup
 * (`src/lib/agency-verification.ts`). The words say what the far side is: a
 * portal with gaps is "searched", and a member sign-in is named before the
 * staffer meets the login form.
 *
 * A level card passes `check`, and then the same words become a button when
 * the DiveDay browser extension is in this browser: the extension reads the
 * agency's page from the staffer's own browser and a match certifies the card
 * (H-105, `AgencyCheck`). Without the extension it is still this link.
 */
const LINK_KEYS: Record<AgencyVerificationPage["kind"], StaffMessageKey> = {
  check: "divers.certifications.checkWithAgency",
  search_portal: "divers.certifications.searchAgencyPortal",
  member_sign_in: "divers.certifications.checkWithAgencyMemberSignIn",
};

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
  const page = agencyVerificationPage(agency);
  if (!page) return null;
  const name = t(AGENCY_KEYS[agency]);
  const label = t(LINK_KEYS[page.kind], { agency: name });
  if (!check) {
    return (
      <a
        href={page.url}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-1 block w-fit text-sm font-semibold text-primary hover:underline print:hidden"
      >
        {label}
      </a>
    );
  }
  return (
    <AgencyCheck
      href={page.url}
      query={check.query}
      certificationId={check.certificationId}
      awaiting={check.awaiting}
      action={check.action}
      copy={{
        check: label,
        checking: t("divers.certifications.agencyCheck.checking", { agency: name }),
        matched: t("divers.certifications.agencyCheck.matched", { agency: name }),
        levelUnconfirmed: t("divers.certifications.agencyCheck.levelUnconfirmed", {
          agency: name,
        }),
        noRecord: t("divers.certifications.agencyCheck.noRecord", { agency: name }),
        unreadable: t("divers.certifications.agencyCheck.unreadable", { agency: name }),
        invalid: t("divers.notices.invalid"),
        undo: t("shared.undoToast.undo"),
        undoPending: t("shared.undoToast.pendingLabel"),
        undoFailed: t("divers.notices.cardUndoFailed"),
      }}
    />
  );
}
