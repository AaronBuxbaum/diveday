import { SubmitButton } from "@/components/SubmitButton";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { CompactDisclosureRow } from "@/components/ui/disclosure";
import type { StaffTranslator } from "@/i18n/staff-messages";
import type { Role } from "@/lib/authz";
import { rolesMissingCredential } from "@/lib/crew-roles";
import { cachedListFormat } from "@/lib/intl-cache";
import { type CardCredential, CREDENTIALED_ROLES } from "../credential-rows";

const MISSING_KIND_KEYS = {
  instructor: "staffing.credentials.missing.instructor",
  assistant_instructor: "staffing.credentials.missing.assistant_instructor",
  divemaster: "staffing.credentials.missing.divemaster",
  captain: "staffing.credentials.missing.captain",
} as const;

/**
 * **A staff credential is a fact, never a badge and never a gate** — ADR
 * 20260827-the-shops-shelves, decision 3 ("credentials are a quiet ledger
 * beneath; renewal words, never gates — H-59"). **The ledger is the card**
 * (visual review 2026-10-24, A09): the list that stood at the foot of the Team
 * page repeated every card above it, so each person's credentials are read,
 * reviewed and removed here, on their own card.
 *
 * What this person sails on, on the person (third review, items 2 and 36). A
 * role that sails on a card says "No credentials on file", or, when something
 * is on file that does not answer the role, names the kind it lacks ("No
 * captain’s license on file", issue #2548); anyone else with nothing recorded
 * gets no row.
 *
 * Each credential is one line: its name, its renewal word, a muted "Needs
 * review" while nobody has looked at it, and its acts. **Nothing here disables
 * anything** (H-59): a lapsed rating keeps every act a current one has, and
 * the clock is a word, never colour alone.
 */
export function StaffCardCredentials({
  personId,
  roles,
  credentials,
  locale,
  t,
  reviewAction,
  deleteAction,
}: {
  personId: string;
  roles: readonly Role[];
  credentials: readonly CardCredential[];
  locale: string;
  t: StaffTranslator;
  reviewAction: (formData: FormData) => void | Promise<void>;
  deleteAction: (formData: FormData) => void | Promise<void>;
}) {
  const sailsOnACard = roles.some((role) => CREDENTIALED_ROLES.includes(role));
  if (credentials.length === 0 && !sailsOnACard) return null;
  const missing = rolesMissingCredential(
    roles,
    credentials.map((credential) => credential.kind),
  ).map((role) => t(MISSING_KIND_KEYS[role]));
  return (
    <div className="mt-4">
      <CompactDisclosureRow
        id={`credentials-${personId}`}
        label={t("staffing.credentials.heading")}
        value={
          credentials.length === 0
            ? t("staffing.credentials.noneOnFile")
            : missing.length > 0
              ? missing.join(" · ")
              : cachedListFormat(locale).format(credentials.map((credential) => credential.name))
        }
      >
        {credentials.length > 0 ? (
          <ul className="flex flex-col gap-2 text-sm">
            {credentials.map((credential) => (
              <li key={credential.id} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="font-medium">{credential.name}</span>
                {credential.detail ? <span className="text-muted">{credential.detail}</span> : null}
                {credential.renewalWord ? (
                  <span
                    className={
                      credential.renewal === "overdue" || credential.renewal === "due-soon"
                        ? "font-medium text-warning-strong"
                        : "text-muted"
                    }
                  >
                    {credential.renewalWord}
                  </span>
                ) : null}
                {credential.reviewed ? null : (
                  <Badge tone="neutral" size="sm">
                    {t("staffing.credentials.pending")}
                  </Badge>
                )}
                <span className="ms-auto flex flex-wrap items-center gap-3">
                  {credential.reviewed ? null : (
                    <form action={reviewAction}>
                      <input type="hidden" name="credentialId" value={credential.id} />
                      <input type="hidden" name="status" value="verified" />
                      <SubmitButton
                        pendingLabel={t("staffing.credentials.saving")}
                        className={buttonClass({ variant: "ghost", size: "sm", flush: true })}
                      >
                        {t("staffing.credentials.markVerified")}
                      </SubmitButton>
                    </form>
                  )}
                  <form action={deleteAction}>
                    <input type="hidden" name="credentialId" value={credential.id} />
                    <SubmitButton
                      pendingLabel={t("staffing.credentials.removing")}
                      className={buttonClass({ variant: "ghost", size: "sm", flush: true })}
                    >
                      {t("staffing.credentials.remove")}
                    </SubmitButton>
                  </form>
                </span>
              </li>
            ))}
          </ul>
        ) : null}
        <a
          href="#add-credential"
          className={buttonClass({ variant: "secondary", size: "sm", className: "mt-3" })}
        >
          {t("staffing.credentials.add")}
        </a>
      </CompactDisclosureRow>
    </div>
  );
}
