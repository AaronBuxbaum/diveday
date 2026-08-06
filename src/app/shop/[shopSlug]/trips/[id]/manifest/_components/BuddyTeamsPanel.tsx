import { buttonClass } from "@/components/ui/button";
import { controlClass, Field } from "@/components/ui/form";
import type { TripBuddyTeam } from "@/db/buddy-pairs";
import type { StaffTranslator } from "@/i18n/staff-messages";

/** One person the builder can offer: the form's flat member token plus a name. */
export type BuddyMemberOption = { token: string; label: string };

/**
 * Buddy teams (ADR 20260804-buddy-teams). Grouping is a decision about
 * this departure, made here because this is the surface the roll call
 * runs from. A team is two or more, and a member is a seated diver or a
 * crew person — the divemaster leading a group holds no booking.
 * Management controls only, so the whole panel stays off the printed
 * manifest; the team itself prints on each member's row.
 */
export function BuddyTeamsPanel({
  buddyTeamsList,
  diverOptions,
  crewOptions,
  unteamedDivers,
  buddyErrorText,
  formBuddyTeamAction,
  addBuddyTeamMemberAction,
  removeBuddyTeamMemberAction,
  dissolveBuddyTeamAction,
  t,
}: {
  buddyTeamsList: TripBuddyTeam[];
  diverOptions: BuddyMemberOption[];
  crewOptions: BuddyMemberOption[];
  unteamedDivers: ReadonlyArray<{ fullName: string }>;
  buddyErrorText: string | null;
  formBuddyTeamAction: (formData: FormData) => Promise<void>;
  addBuddyTeamMemberAction: (formData: FormData) => Promise<void>;
  removeBuddyTeamMemberAction: (formData: FormData) => Promise<void>;
  dissolveBuddyTeamAction: (formData: FormData) => Promise<void>;
  t: StaffTranslator;
}) {
  return (
    <section aria-labelledby="buddy-teams-heading" className="mt-9 print:hidden">
      <h2 id="buddy-teams-heading" className="text-lg font-semibold">
        {t("trips.manifest.buddyHeading")}
      </h2>
      <p className="mt-1 max-w-prose text-sm text-muted">{t("trips.manifest.buddyDescription")}</p>
      {buddyErrorText ? (
        <p className="mt-2 text-sm font-semibold text-danger" role="status">
          {buddyErrorText}
        </p>
      ) : null}
      {buddyTeamsList.length === 0 ? (
        <p className="mt-3 text-sm text-muted">{t("trips.manifest.buddyNoTeams")}</p>
      ) : (
        <ul className="mt-3 divide-y divide-border rounded-lg border border-border bg-surface">
          {buddyTeamsList.map((team, index) => {
            // Members of *this* team can't join another, and neither can a
            // diver already on one — so the "add" picker offers whoever is
            // left, plus any crew not already on this team.
            const onThisTeam = new Set(
              team.members.map((member) =>
                member.kind === "diver" ? `diver:${member.bookingId}` : `crew:${member.personId}`,
              ),
            );
            const free = (options: BuddyMemberOption[]) =>
              options.filter((option) => !onThisTeam.has(option.token));
            const addableDivers = free(diverOptions);
            const addableCrew = free(crewOptions);
            return (
              <li key={team.teamId} className="px-4 py-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted">
                      {t("trips.manifest.buddyTeamLabel", { number: index + 1 })}
                    </p>
                    <ul className="mt-1.5 flex flex-wrap items-center gap-2">
                      {team.members.map((member) => {
                        const token =
                          member.kind === "diver"
                            ? `diver:${member.bookingId}`
                            : `crew:${member.personId}`;
                        const name =
                          member.kind === "crew"
                            ? t("trips.manifest.buddyCrewName", { name: member.fullName })
                            : member.cancelled
                              ? t("trips.manifest.buddyCancelledName", { name: member.fullName })
                              : member.fullName;
                        // Only a team of three or more can lose a member and
                        // stay a team; at two the act is a dissolve, which
                        // has its own button and its own entry on the trail.
                        const removable = team.members.length > 2;
                        return (
                          <li
                            key={token}
                            className={`flex items-center gap-1 rounded-full border border-border bg-surface-sunken py-1 font-semibold ${
                              removable ? "ps-3 pe-1" : "px-3"
                            }`}
                          >
                            <span>{name}</span>
                            {removable ? (
                              <form action={removeBuddyTeamMemberAction} className="flex">
                                <input type="hidden" name="teamId" value={team.teamId} />
                                <input type="hidden" name="member" value={token} />
                                {/* A real target, not a bare "×" glyph: this
                                    panel is worked on a moving deck, and the
                                    chip shape is what makes the control read
                                    as a control rather than a typo. */}
                                <button
                                  type="submit"
                                  className="flex size-7 items-center justify-center rounded-full text-lg leading-none text-muted hover:bg-danger/10 hover:text-danger"
                                >
                                  <span aria-hidden="true">×</span>
                                  <span className="sr-only">
                                    {t("trips.manifest.buddyRemoveMember", {
                                      name: member.fullName,
                                    })}
                                  </span>
                                </button>
                              </form>
                            ) : null}
                          </li>
                        );
                      })}
                    </ul>
                    <p className="mt-1 text-sm text-muted">
                      {t("trips.manifest.buddyRecordedBy", { name: team.recordedByName })}
                    </p>
                  </div>
                  <form action={dissolveBuddyTeamAction}>
                    <input type="hidden" name="teamId" value={team.teamId} />
                    <button
                      type="submit"
                      className={buttonClass({ variant: "secondary", size: "boat" })}
                    >
                      {t("trips.manifest.buddyDissolve")}
                    </button>
                  </form>
                </div>
                {addableDivers.length + addableCrew.length > 0 ? (
                  <form
                    action={addBuddyTeamMemberAction}
                    className="mt-3 flex flex-wrap items-end gap-2"
                  >
                    <input type="hidden" name="teamId" value={team.teamId} />
                    <Field label={t("trips.manifest.buddyAddMemberLabel")}>
                      <select name="member" required defaultValue="" className={controlClass}>
                        <option value="" disabled>
                          {t("trips.manifest.buddySelectPlaceholder")}
                        </option>
                        <optgroup label={t("trips.manifest.buddyDiverGroupLabel")}>
                          {addableDivers.map((option) => (
                            <option key={option.token} value={option.token}>
                              {option.label}
                            </option>
                          ))}
                        </optgroup>
                        <optgroup label={t("trips.manifest.buddyCrewGroupLabel")}>
                          {addableCrew.map((option) => (
                            <option key={option.token} value={option.token}>
                              {option.label}
                            </option>
                          ))}
                        </optgroup>
                      </select>
                    </Field>
                    <button
                      type="submit"
                      className={buttonClass({ variant: "secondary", size: "boat" })}
                    >
                      {t("trips.manifest.buddyAddMemberSubmit")}
                    </button>
                  </form>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      {/*
       * The builder: tick two or more. A multi-select checkbox list rather
       * than N paired dropdowns, because a team has no fixed size and the
       * old two-select form could only ever express the one case the model
       * no longer restricts us to.
       */}
      {diverOptions.length + crewOptions.length >= 2 ? (
        <form action={formBuddyTeamAction} className="mt-4">
          <fieldset className="rounded-lg border border-border bg-surface p-4">
            <legend className="px-1 text-sm font-semibold">
              {t("trips.manifest.buddyNewTeamHeading")}
            </legend>
            <p className="max-w-prose text-sm text-muted">{t("trips.manifest.buddyNewTeamHint")}</p>
            {diverOptions.length > 0 ? (
              <>
                <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-muted">
                  {t("trips.manifest.buddyDiverGroupLabel")}
                </p>
                <div className="mt-1 flex flex-wrap gap-x-5 gap-y-2">
                  {diverOptions.map((option) => (
                    <label key={option.token} className="flex items-center gap-2 text-base">
                      <input type="checkbox" name="members" value={option.token} />
                      <span>{option.label}</span>
                    </label>
                  ))}
                </div>
              </>
            ) : null}
            {crewOptions.length > 0 ? (
              <>
                <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-muted">
                  {t("trips.manifest.buddyCrewGroupLabel")}
                </p>
                <div className="mt-1 flex flex-wrap gap-x-5 gap-y-2">
                  {crewOptions.map((option) => (
                    <label key={option.token} className="flex items-center gap-2 text-base">
                      <input type="checkbox" name="members" value={option.token} />
                      <span>{option.label}</span>
                    </label>
                  ))}
                </div>
              </>
            ) : null}
            <div className="mt-4">
              <button type="submit" className={buttonClass({ size: "boat" })}>
                {t("trips.manifest.buddyFormSubmit")}
              </button>
            </div>
          </fieldset>
        </form>
      ) : unteamedDivers.length === 1 && unteamedDivers[0] ? (
        // An odd roster is normal, never an error — say so instead of
        // rendering a builder that can only fail.
        <p className="mt-3 text-sm text-muted">
          {t("trips.manifest.buddyUnteamedOne", { name: unteamedDivers[0].fullName })}
        </p>
      ) : unteamedDivers.length === 0 && buddyTeamsList.length > 0 ? (
        <p className="mt-3 text-sm text-muted">{t("trips.manifest.buddyEveryoneTeamed")}</p>
      ) : null}
    </section>
  );
}
