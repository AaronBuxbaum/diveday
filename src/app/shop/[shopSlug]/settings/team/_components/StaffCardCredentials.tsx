import { buttonClass } from "@/components/ui/button";
import { CompactDisclosureRow } from "@/components/ui/disclosure";
import type { StaffTranslator } from "@/i18n/staff-messages";
import type { Role } from "@/lib/authz";
import { cachedListFormat } from "@/lib/intl-cache";
import { type CardCredential, CREDENTIALED_ROLES } from "../credential-rows";

/**
 * What this person sails on, on the person (third review, items 2 and 36).
 * The ledger at the foot of the page is where a credential is added and
 * reviewed; this row is how an owner reading Sal's card learns he has no
 * license recorded. A role that sails on a card says "No credentials on file"; anyone
 * else with nothing recorded gets no row.
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
  return (
    <div className="mt-4">
      <CompactDisclosureRow
        id={`credentials-${personId}`}
        label={t("staffing.credentials.heading")}
        value={
          credentials.length > 0
            ? cachedListFormat(locale).format(credentials.map((credential) => credential.name))
            : t("staffing.credentials.noneOnFile")
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
