import type { DbExecutor } from "@/db/client";
import { ratingCredentialsByPerson } from "@/db/staff-credentials";
import type { getStaffingView } from "@/db/staffing";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { staffingWarningText } from "@/i18n/staffing-warning-labels";
import { shopPath } from "@/lib/staff-notices";
import { staffingWarnings, type WarningDeparture } from "@/lib/staffing-warnings";
import { CREDENTIAL_KIND_KEYS } from "../../settings/team/credential-kinds";

/** One warning, already in words, and where it can be fixed. */
export type StaffingWarningLine = { key: string; text: string; href: string | null };

/**
 * The week's crew warnings, in words (batch 4, D3): who is rostered on what is
 * read off the view's own crewing lists, so a departure is warned about exactly
 * when the week shows somebody crewing it.
 */
export async function crewWarningLines(input: {
  db: DbExecutor;
  shopId: string;
  shopSlug: string;
  view: Awaited<ReturnType<typeof getStaffingView>>;
  now: Date;
  t: StaffTranslator;
  locale: string;
  timeZone: string;
}): Promise<StaffingWarningLine[]> {
  const { view, t } = input;
  const credentials = await ratingCredentialsByPerson(
    input.db,
    input.shopId,
    view.staff.map((member) => member.person.id),
  );
  const departures = new Map<string, WarningDeparture>();
  for (const member of view.staff) {
    for (const trip of member.crewingTrips) {
      const entry = departures.get(trip.tripId) ?? {
        tripId: trip.tripId,
        title: trip.title,
        meetings: trip.meetings,
        crew: [],
      };
      departures.set(trip.tripId, { ...entry, crew: [...entry.crew, member.person.id] });
    }
  }
  const warnings = staffingWarnings({
    departures: [...departures.values()],
    people: view.staff.map((member) => ({
      personId: member.person.id,
      name: member.person.fullName,
      credentials: credentials.get(member.person.id) ?? [],
    })),
    timeZone: input.timeZone,
    now: input.now,
  });
  const credentialWord = (kind: string) =>
    Object.hasOwn(CREDENTIAL_KIND_KEYS, kind)
      ? t(CREDENTIAL_KIND_KEYS[kind as keyof typeof CREDENTIAL_KIND_KEYS])
      : kind;
  return warnings.map((warning, index) => ({
    key: `${warning.code}-${index}`,
    text: staffingWarningText(t, warning, {
      locale: input.locale,
      timeZone: input.timeZone,
      credentialWord,
    }),
    href:
      warning.code === "long_day"
        ? null
        : warning.code === "credential_expired" || warning.code === "credential_not_yet_issued"
          ? `${shopPath(input.shopSlug, "settings", "team")}#credentials`
          : `${shopPath(input.shopSlug, "trips", warning.tripId)}?view=details#crew`,
  }));
}
