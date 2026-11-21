import { StoredPhoto } from "@/components/StoredPhoto";
import type { StaffMember } from "@/features/accounts/staff-accounts";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { formatDateWithYear } from "@/lib/format";
import { publicName } from "../public-name";
import { type CrewYear, StaffYearLine } from "./StaffYear";

export function StaffIdentity({
  member,
  year,
  t,
  locale,
  timezone,
}: {
  member: StaffMember;
  year?: CrewYear;
  t: StaffTranslator;
  locale: string;
  timezone: string;
}) {
  return (
    <div className="flex min-w-0 items-start gap-3">
      {member.staffPhotoPath ? (
        <StoredPhoto
          src={member.staffPhotoPath}
          alt=""
          className="size-10 shrink-0 rounded-full"
          sizes="40px"
        />
      ) : null}
      <div className="min-w-0">
        <p className="font-medium">{member.fullName}</p>
        <p className="text-sm text-muted wrap-anywhere">{member.email}</p>
        <StaffYearLine year={year} t={t} />
        {/* What this person publishes to divers, when they have said yes on
              their own staffing page (issue #1357). Read-only here: the switch
              is theirs, and a shop that could edit it would be overriding
              somebody's consent from the other side. Nothing at all for
              somebody who declined — a row that said so would be a list of who
              declined, which is the boundary the feature rests on. */}
        {/* The stamp rides the name and only the name: a row with no name
              shows nothing at all, so a declined answer and a never-asked one
              stay indistinguishable (issue #1357). */}
        {publicName(member) && member.crewPublicConsentAt ? (
          <p className="text-sm text-muted">
            {t("settings.team.publicNameSeen", {
              name: publicName(member),
              date: formatDateWithYear(member.crewPublicConsentAt, locale, timezone),
            })}
          </p>
        ) : null}
      </div>
    </div>
  );
}
