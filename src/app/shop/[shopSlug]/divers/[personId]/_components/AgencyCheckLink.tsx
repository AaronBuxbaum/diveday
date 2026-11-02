import {
  type AgencyCheckCopy,
  agencyCheckCopy,
  agencyLinkLabel,
} from "@/app/shop/[shopSlug]/_components/agency-check/agency-check-copy";
import { buttonClass } from "@/components/ui/button";
import type { CertificationAgency } from "@/db/schema";
import type { StaffTranslator } from "@/i18n/staff-messages";
import type { AgencyCheckQuery, AgencyListedKind } from "@/lib/agency-check";
import type { AgencyCheckResult, AgencyListedAddResult } from "../agency-check-actions";
import { AgencyCheck } from "./AgencyCheck";

/**
 * "Check with SSI": the agency's own public verification page, in a new tab,
 * beside a card that is waiting for somebody to confirm it. DiveDay's servers
 * never call the agency (H-20261007-request-supported-c-card). Renders nothing for an agency with no lookup
 * (`src/lib/agency-verification.ts`). The words say what the far side is
 * (`agencyLinkLabel`): a portal with gaps is "searched", and a member sign-in
 * is named before the staffer meets the login form.
 *
 * A level card passes `check`, and then the same words become a button when
 * the DiveDay browser extension is in this browser: the extension reads the
 * agency's page from the staffer's own browser and a match certifies the card
 * (H-20261008-cert-check-extension, `AgencyCheck`). Without the extension it is still this link.
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
    /** A nitrox or specialty card (issue #2592), with its kind: it posts its table and words its button by kind. */
    card?: { type: "nitrox" | "specialty"; kind: AgencyListedKind };
    awaiting: boolean;
    query: AgencyCheckQuery | null;
    /** The shop's switch keeps this agency's check off (H-20261014-padi-divechek): say so beside the link. */
    switchedOff?: boolean;
    action: (previous: AgencyCheckResult, formData: FormData) => Promise<AgencyCheckResult>;
    /** Files the page's other cards the staffer ticked, after a match (layer 3). */
    addListed?: (
      previous: AgencyListedAddResult,
      formData: FormData,
    ) => Promise<AgencyListedAddResult>;
  };
}) {
  const link = agencyLinkLabel(t, agency);
  if (!link) return null;
  if (!check) {
    return (
      <span className="flex">
        <a
          href={link.href}
          target="_blank"
          rel="noopener noreferrer"
          className={buttonClass({
            variant: "link",
            size: "sm",
            flush: true,
            className: "mt-1 print:hidden",
          })}
        >
          {link.label}
        </a>
      </span>
    );
  }
  return (
    <AgencyCheck
      href={link.href}
      query={check.query}
      certificationId={check.certificationId}
      cardType={check.card?.type}
      awaiting={check.awaiting}
      action={check.action}
      addListed={check.addListed}
      copy={withCardButton(agencyCheckCopy(t, agency, link.label), check.card?.kind)}
      offNote={check.switchedOff ? t("shared.padiChecksOff") : undefined}
    />
  );
}

/** The copy with the button worded for a nitrox or specialty card's kind: "Check Nitrox with SSI". */
function withCardButton(
  copy: AgencyCheckCopy,
  kind: AgencyListedKind | undefined,
): AgencyCheckCopy {
  return kind ? { ...copy, check: copy.checkKind[kind] } : copy;
}
