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
 * What this person sails on, on the person (third review, items 2 and 36).
 * The ledger at the foot of the page is where a credential is added and
 * reviewed; this row is how an owner reading Sal's card learns he has no
 * license recorded. A role that sails on a card says "No credentials on file", or,
 * when something is on file that does not answer the role, names the kind it lacks
 * ("No captain’s license on file", issue #2548); anyone else with nothing recorded
 * gets no row. Words only: nothing here gates an assignment (H-59).
 */
export function StaffCardCredentials({
  personId,
  roles,
  credentials,
  locale,
  t,
}: {
  personId: string;
  roles: readonly Role[];
  credentials: readonly CardCredential[];
  locale: string;
  t: StaffTranslator;
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
          <ul className="flex flex-col gap-1 text-sm">
            {credentials.map((credential) => (
              <li key={credential.id} className="flex flex-wrap gap-x-2">
                <span className="font-medium">{credential.name}</span>
                {credential.renewalWord ? (
                  <span className="text-muted">{credential.renewalWord}</span>
                ) : null}
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
