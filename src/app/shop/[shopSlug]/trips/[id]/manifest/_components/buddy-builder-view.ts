import type { listTripBuddyTeams } from "@/db/buddy-pairs";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { cachedListFormat } from "@/lib/intl-cache";
import type { ManifestBuddyTeam, TripManifest } from "@/lib/manifests";
import { unteamedDivers as divingAndUnteamed } from "@/lib/participant-types";

/**
 * **The buddy-team builder's inputs**: who can still join a new team, the
 * options the picker offers, how a team is named on a row, and where a
 * refusal from `?buddyError=` renders.
 */
export function buddyBuilderView({
  manifest,
  buddyTeamsList,
  buddyError,
  locale,
  t,
}: {
  /** This checkpoint's manifest, held seats already withheld. */
  manifest: TripManifest;
  buddyTeamsList: Awaited<ReturnType<typeof listTripBuddyTeams>>;
  /** The refusal code the last buddy action redirected with, if any. */
  buddyError: string | undefined;
  locale: string;
  t: StaffTranslator;
}) {
  // Who can still join a *new* team: any active roster entry not already on
  // one — including a member of a team whose other seat was cancelled, which
  // must be dissolved first (the server refuses it too; this just keeps the
  // picker honest). Crew are always offerable: one divemaster commonly leads
  // several groups on one boat, so they carry no "at most one team" rule.
  const teamedBookingIds = new Set(
    buddyTeamsList.flatMap((team) =>
      team.members.flatMap((member) => (member.kind === "diver" ? [member.bookingId] : [])),
    ),
  );
  const unteamedDivers = divingAndUnteamed(manifest.divers, teamedBookingIds);
  // Everyone the builder can offer, as `{ token, label }` — divers who are
  // free, and every assigned crew member.
  const diverOptions = unteamedDivers.map((diver) => ({
    token: `diver:${diver.bookingId}`,
    label: diver.fullName,
  }));
  const crewOptions = manifest.crew.map((member) => ({
    token: `crew:${member.id}`,
    label: member.fullName,
  }));
  // "Buddy team: Ana and Ben" — names de-duplicated (a divemaster on two teams
  // with one diver in common is still one body to look for) and joined through
  // `Intl.ListFormat` in the negotiated locale, never a hard-coded ", ".
  const teamNameList = cachedListFormat(locale, { type: "conjunction" });
  const buddyTeamLabel = (teams: ReadonlyArray<ManifestBuddyTeam>) => {
    const names = [...new Set(teams.flatMap((team) => team.others.map((o) => o.fullName)))];
    return names.length === 0
      ? null
      : t("shared.buddyTeam.with", { names: teamNameList.format(names) });
  };
  const buddyErrorText =
    buddyError === "duplicate"
      ? t("manifest.buddyErrorDuplicate")
      : buddyError === "teamed"
        ? t("manifest.buddyErrorAlreadyTeamed")
        : buddyError === "few"
          ? t("manifest.buddyErrorTooFew")
          : buddyError === "not-diver"
            ? t("manifest.buddyErrorNotDiver")
            : buddyError
              ? t("manifest.buddyErrorGeneric")
              : null;
  // A refusal renders beside the form that produced it
  // (docs/design/forms-and-controls.md). `few` is the one code only the
  // new-team builder can earn, so it lands in that fieldset's action row;
  // every other code can come from any of the per-team add/remove/dissolve
  // forms and has no single home, so it stays at the top of the panel.
  const buddyErrorForm: "builder" | "panel" | null = buddyErrorText
    ? buddyError === "few"
      ? "builder"
      : "panel"
    : null;
  return {
    buddyTeamLabel,
    /** Named as `BuddyTeamsPanel` takes them, so the page hands them on whole. */
    panel: { unteamedDivers, diverOptions, crewOptions, buddyErrorText, buddyErrorForm },
  };
}
