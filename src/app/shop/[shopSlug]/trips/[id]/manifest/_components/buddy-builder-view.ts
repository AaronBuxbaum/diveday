import { type listTripBuddyTeams, type PartyTeamPlan, partyConfirmKey } from "@/db/buddy-pairs";
import { partyLeftReasonText } from "@/i18n/buddy-labels";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { cachedListFormat } from "@/lib/intl-cache";
import type { ManifestBuddyTeam, TripManifest } from "@/lib/manifests";
import { unteamedDivers as divingAndUnteamed } from "@/lib/participant-types";
import { partyAgesUnconfirmed, partyLeftReason } from "@/lib/party-teams";

/**
 * **The buddy-team builder's inputs**: who can still join a new team, the
 * options the picker offers, how a team is named on a row, and where a
 * refusal from `?buddyError=` renders.
 */
export function buddyBuilderView({
  manifest,
  buddyTeamsList,
  buddyError,
  partyPlan,
  locale,
  t,
}: {
  /** This checkpoint's manifest, held seats already withheld. */
  manifest: TripManifest;
  /**
   * Who came together, which parties one tap may team, and which it leaves
   * and why (`planPartyTeams`, item 50): the button and the action read one plan.
   */
  partyPlan: PartyTeamPlan;
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
  // One policy for party planning and hand-built teams. A caution never
  // refuses a team: crew may be deliberately accompanying a child or student.
  // A crew assignment alone proves neither a card nor the adult's age.
  const diverByBooking = new Map(manifest.divers.map((diver) => [diver.bookingId, diver]));
  const teamWarnings: Record<string, string[]> = {};
  for (const team of buddyTeamsList) {
    const bookingIds = team.members.flatMap((member) =>
      member.kind === "diver" && !member.cancelled && diverByBooking.has(member.bookingId)
        ? [member.bookingId]
        : [],
    );
    const members = bookingIds.flatMap((bookingId) => {
      const member = partyPlan.members.get(bookingId);
      return member ? [member] : [];
    });
    // Crew-only teams have no student or junior to place. A single diver
    // beside crew still needs the same course/age context as a larger team.
    const reason = members.length > 0 ? partyLeftReason(partyPlan.departure, members) : null;
    const warnings = reason
      ? [t("manifest.buddyTeamCaution", { reason: partyLeftReasonText(t, reason) })]
      : [];
    if (
      bookingIds.some((bookingId) => diverByBooking.get(bookingId)?.readiness.status !== "ready")
    ) {
      // Only the shared readiness verdict leaves this derivation; no raw
      // medical answer or blocker wording is repeated on the buddy panel.
      warnings.push(t("manifest.buddyTeamNotCleared"));
    }
    teamWarnings[team.teamId] = warnings;
  }
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
            : buddyError === "busy"
              ? t("manifest.buddyErrorBusy")
              : buddyError === "confirm-adults"
                ? t("manifest.buddyErrorConfirmAdults")
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
  // **Who came together, and who came alone** (fifth-loop ideas, item 50):
  // the divers still to team, grouped by the party they booked in. A line to
  // build from, never a pairing made for anyone. Every name is the plan's own
  // seat, the one "Team up each party" reads (dive-domain review of layer
  // r5-4, second pass, N7), so the lines and the tap cannot disagree.
  const nameOf = (bookingId: string) => partyPlan.names.get(bookingId) ?? "";
  const together = [
    ...partyPlan.teamable,
    ...partyPlan.ageUnconfirmed,
    ...partyPlan.left.map((party) => party.bookingIds),
  ];
  const groupList = cachedListFormat(locale, { type: "unit", style: "short" });
  const partyLines =
    together.length === 0
      ? null
      : {
          together: t("manifest.buddyCameTogether", {
            parties: groupList.format(together.map((ids) => teamNameList.format(ids.map(nameOf)))),
          }),
          alone:
            partyPlan.alone.length === 0
              ? null
              : t("manifest.buddyCameAlone", {
                  names: groupList.format(partyPlan.alone.map(nameOf)),
                }),
          // Each party the tap leaves, said with its reason (dive-domain
          // review of layer r5-4, BLOCK 1): a junior, an intro dive, a family.
          left: partyPlan.left.map(({ bookingIds, reason }) =>
            t("manifest.buddyPartyLeft", {
              names: teamNameList.format(bookingIds.map(nameOf)),
              reason: partyLeftReasonText(t, reason),
            }),
          ),
          /** Parties "Team up each party" would make a team of: the action's own plan. */
          teamable: partyPlan.teamable.length,
          // Each party the tap teams only once the staffer says everyone in it
          // is 18 or over (issue 2808): its tick box carries the party's exact
          // seats, so a confirmation never reaches a party that changed since.
          // The label names who has no age on file, so a staffer facing a
          // forty-year-old beside an unknown knows whom they vouch for.
          confirmAdults: partyPlan.ageUnconfirmed.map((bookingIds) => ({
            key: partyConfirmKey(bookingIds),
            label: t("manifest.buddyPartyConfirmAdults", {
              names: teamNameList.format(bookingIds.map(nameOf)),
              unknown: teamNameList.format(
                bookingIds
                  .filter((bookingId) => {
                    const member = partyPlan.members.get(bookingId);
                    return !member || partyAgesUnconfirmed([member]);
                  })
                  .map(nameOf),
              ),
            }),
          })),
        };
  return {
    buddyTeamLabel,
    /** Named as `BuddyTeamsPanel` takes them, so the page hands them on whole. */
    panel: {
      unteamedDivers,
      diverOptions,
      crewOptions,
      buddyErrorText,
      buddyErrorForm,
      partyLines,
      teamWarnings,
    },
  };
}
