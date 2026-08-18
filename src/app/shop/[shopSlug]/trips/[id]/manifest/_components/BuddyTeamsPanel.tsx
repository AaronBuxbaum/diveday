import { EmptyState } from "@/components/EmptyState";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { sectionCardClass } from "@/components/ui/card";
import { DisclosureCaret } from "@/components/ui/DisclosureCaret";
import { controlClass, Field, FormStatus } from "@/components/ui/form";
import type { TripBuddyTeam } from "@/db/buddy-pairs";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { BuddyDragGroups } from "./BuddyDragGroups";

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
  defaultOpen,
  buddyTeamsList,
  diverOptions,
  crewOptions,
  unteamedDivers,
  buddyErrorText,
  buddyErrorForm,
  formBuddyTeamAction,
  addBuddyTeamMemberAction,
  removeBuddyTeamMemberAction,
  dissolveBuddyTeamAction,
  t,
}: {
  /**
   * Arrive with the panel open — set by the `?buddies=open` the buddy actions
   * redirect back with, so the panel does not fold shut between the steps of
   * one team-building session.
   */
  defaultOpen: boolean;
  buddyTeamsList: TripBuddyTeam[];
  diverOptions: BuddyMemberOption[];
  crewOptions: BuddyMemberOption[];
  unteamedDivers: ReadonlyArray<{ fullName: string }>;
  buddyErrorText: string | null;
  /**
   * Which form the refusal answers, so it renders beside that form rather
   * than floating above the whole panel (docs/design/forms-and-controls.md).
   * The page resolves it from `?buddyError=`; "builder" is the one refusal a
   * staffer earns from the new-team fieldset ("a buddy team needs at least
   * two people"), every other code answers one of the per-team forms and has
   * no single home, so it stays at the top of the panel's forms.
   */
  buddyErrorForm: "builder" | "panel" | null;
  formBuddyTeamAction: (formData: FormData) => Promise<void>;
  addBuddyTeamMemberAction: (formData: FormData) => Promise<void>;
  removeBuddyTeamMemberAction: (formData: FormData) => Promise<void>;
  dissolveBuddyTeamAction: (formData: FormData) => Promise<void>;
  t: StaffTranslator;
}) {
  // The builder only renders when there are two people left to tick. A
  // "too few" refusal with no builder on screen has nowhere to sit, so it
  // falls back to the panel-level status rather than disappearing.
  const showBuilder = diverOptions.length + crewOptions.length >= 2;
  const builderError = buddyErrorForm === "builder" && showBuilder ? buddyErrorText : null;
  const panelError = builderError ? null : buddyErrorText;
  return (
    <section aria-labelledby="buddy-teams-heading" className="mt-9 print:hidden">
      {/* The whole panel sits behind one disclosure line. Grouping people is
          dock/desk prep, done once per departure — but the open panel (team
          rows, per-team pickers, dissolve buttons) stood at permanent height
          on every manifest visit, between the roll call and the offline
          backstop. The teams themselves already ride on each member's row
          where roll call reads them, so at rest this section owes the page
          one line: how many teams, and who is not on one. It arrives open
          when a refusal needs reading — a submit's answer must never hide
          behind the fold it came from. */}
      <details className="group/buddypanel" open={buddyErrorText || defaultOpen ? true : undefined}>
        {/* Two alignments, not one: the caret centres on the *block* of text
            (`items-center`), while the heading and its count share a baseline
            inside that block. Flattened into a single baseline row the caret
            hung off the text's baseline like a stray comma — a 12px mark
            baseline-aligned to an 18px heading sits well below its optical
            centre, which is how it read as misaligned rather than as the
            control it is. */}
        <summary className="flex min-h-11 w-fit cursor-pointer list-none items-center gap-2 select-none [&::-webkit-details-marker]:hidden">
          <DisclosureCaret className="text-muted group-open/buddypanel:rotate-90" />
          <span className="flex flex-wrap items-baseline gap-x-2">
            <h2 id="buddy-teams-heading" className="text-lg font-semibold">
              {t("manifest.buddyHeading")}
            </h2>
            <span className="text-sm text-muted">
              {t("manifest.buddySummaryTeams", { count: buddyTeamsList.length })}
              {unteamedDivers.length > 0
                ? t("manifest.buddySummaryUnteamed", { count: unteamedDivers.length })
                : ""}
            </span>
          </span>
        </summary>
        <p className="mt-1 max-w-prose text-sm text-muted">{t("manifest.buddyDescription")}</p>
        <FormStatus className="mt-2">{panelError}</FormStatus>
        {/* No empty state when there are no teams. The one this used to render
            — a 200px dashed card reading "No buddy teams yet. Tick two or more
            people below to make one." — said, for the third time on four
            consecutive lines, what the summary already says ("No teams yet · 3
            divers not on a team") and what the description under it already
            asks for. A panel opened on an empty roster instead goes straight to
            the builder, which is the only thing there is to do here. */}
        {buddyTeamsList.length > 0 ? (
          // Bounded, because each row pushes "Dissolve team" to its far edge:
          // full-bleed on a desktop manifest that put a destructive button a
          // thousand pixels from the team it dissolves, aligned to nothing.
          <ul
            className={sectionCardClass({
              padding: "none",
              className: "mt-3 max-w-4xl divide-y divide-border overflow-hidden",
            })}
          >
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
                  {/* No `justify-between`: it pushed "Dissolve team" to the
                      row's far right edge, ~500px from the team it dissolves at
                      a 1280 viewport, aligned to nothing. The control now
                      follows the members/recorded-by block as a trailing item,
                      so it reads as belonging to that team rather than to the
                      panel's right margin. `flex-wrap` still carries it to its
                      own line on a phone, and a team of five wraps its members
                      freely without stranding the button. */}
                  <div className="flex flex-wrap items-start gap-3">
                    <div className="min-w-0">
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted">
                        {t("manifest.buddyTeamLabel", { number: index + 1 })}
                      </p>
                      <ul className="mt-1.5 flex flex-wrap items-center gap-2">
                        {team.members.map((member) => {
                          const token =
                            member.kind === "diver"
                              ? `diver:${member.bookingId}`
                              : `crew:${member.personId}`;
                          const name =
                            member.kind === "crew"
                              ? t("manifest.buddyCrewName", { name: member.fullName })
                              : member.cancelled
                                ? t("manifest.buddyCancelledName", { name: member.fullName })
                                : member.fullName;
                          // Only a team of three or more can lose a member and
                          // stay a team; at two the act is a dissolve, which
                          // has its own button and its own entry on the trail.
                          const removable = team.members.length > 2;
                          return (
                            <li
                              key={token}
                              className={`flex items-center gap-1 rounded-full border border-border bg-surface-sunken font-semibold ${
                                removable ? "py-0.5 ps-4 pe-1" : "px-3 py-1"
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
                                    as a control rather than a typo. `size-11`
                                    is the dock test's floor (44px,
                                    design/principles.md §2) — at `size-7` this
                                    was a 28px hit area for wet fingers, and
                                    the act behind it removes a person from a
                                    buddy team. The chip's own padding grew to
                                    hold it.

                                    `SubmitButton`, not a raw `<button>`: a wet
                                    deck is where a tap that seems not to have
                                    registered gets tapped again, and without
                                    `useFormStatus` this posted twice — the same
                                    double-submit every other destructive control
                                    in the app is already guarded against. The
                                    pending label is the glyph again rather than
                                    a word, because the label lives inside a
                                    44px circle that a word would burst; the
                                    disabled + `aria-busy` state is what says
                                    the tap landed. */}
                                  <SubmitButton
                                    pendingLabel="×"
                                    ariaLabel={t("manifest.buddyRemoveMember", {
                                      name: member.fullName,
                                    })}
                                    className="flex size-11 cursor-pointer items-center justify-center rounded-full text-lg leading-none text-muted disabled:cursor-wait disabled:opacity-70 hover:bg-danger/10 hover:text-danger"
                                  >
                                    <span aria-hidden="true">×</span>
                                  </SubmitButton>
                                </form>
                              ) : null}
                            </li>
                          );
                        })}
                      </ul>
                      <p className="mt-1 text-sm text-muted">
                        {t("manifest.buddyRecordedBy", { name: team.recordedByName })}
                      </p>
                    </div>
                    {/* Nothing in this panel is worked at the rail — grouping
                      people is desk/dock prep, so these controls take the
                      app's default size rather than the roll-call buttons'
                      `boat`. Dissolving is destructive but never this
                      section's main action — and with two or three teams open,
                      a red-boxed `danger` button per row framed the panel's
                      calm content in warnings, so it is the quieter
                      `danger-ghost`: the hue stays, the box waits for hover
                      (design review 20260810). */}
                    <form action={dissolveBuddyTeamAction}>
                      <input type="hidden" name="teamId" value={team.teamId} />
                      <button type="submit" className={buttonClass({ variant: "danger-ghost" })}>
                        {t("manifest.buddyDissolve")}
                      </button>
                    </form>
                  </div>
                  {addableDivers.length + addableCrew.length > 0 ? (
                    <form
                      action={addBuddyTeamMemberAction}
                      className="mt-3 flex flex-wrap items-end gap-2"
                    >
                      <input type="hidden" name="teamId" value={team.teamId} />
                      {/* `markRequired={false}`: this is a one-field form
                          whose submit button is "Add", so the asterisk
                          distinguishes nothing — and two or three open teams
                          put two or three red marks into a panel whose only
                          meaningful warning colour is the dissolve control. The
                          `<select>` keeps `required`; the server refusal it
                          pairs with is real. */}
                      <Field label={t("manifest.buddyAddMemberLabel")} markRequired={false}>
                        <select name="member" required defaultValue="" className={controlClass}>
                          <option value="" disabled>
                            {t("manifest.buddySelectPlaceholder")}
                          </option>
                          <optgroup label={t("manifest.buddyDiverGroupLabel")}>
                            {addableDivers.map((option) => (
                              <option key={option.token} value={option.token}>
                                {option.label}
                              </option>
                            ))}
                          </optgroup>
                          <optgroup label={t("manifest.buddyCrewGroupLabel")}>
                            {addableCrew.map((option) => (
                              <option key={option.token} value={option.token}>
                                {option.label}
                              </option>
                            ))}
                          </optgroup>
                        </select>
                      </Field>
                      <button type="submit" className={buttonClass({ variant: "secondary" })}>
                        {t("manifest.buddyAddMemberSubmit")}
                      </button>
                    </form>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : null}
        {/*
         * The builder: tick two or more. A multi-select checkbox list rather
         * than N paired dropdowns, because a team has no fixed size and the
         * old two-select form could only ever express the one case the model
         * no longer restricts us to.
         */}
        {showBuilder ? (
          // Behind a native disclosure: forming a team happens a handful of
          // times per departure, but the open checkbox grid used to stand at
          // full height on every manifest visit — the rare path at permanent
          // weight (principle 8). The roll call above is the page's job;
          // the builder opens when asked and costs nothing when it isn't.
          // A submit that came back refused must not hide its own answer behind
          // the fold — the disclosure arrives open whenever there is a worded
          // refusal to read. It also arrives open when there are no teams yet:
          // the panel above it is empty then, so a second closed line is a fold
          // in front of the only content this section has.
          <details
            className="group/buddies mt-4"
            open={builderError || buddyTeamsList.length === 0 ? true : undefined}
          >
            <summary className="flex min-h-11 w-fit cursor-pointer list-none items-center gap-2 text-sm font-semibold select-none [&::-webkit-details-marker]:hidden">
              <DisclosureCaret className="text-muted group-open/buddies:rotate-90" />
              {t("manifest.buddyNewTeamHeading")}
            </summary>
            <form action={formBuddyTeamAction} className="mt-2 max-w-4xl">
              <fieldset className={sectionCardClass()}>
                <p className="max-w-prose text-sm text-muted">{t("manifest.buddyNewTeamHint")}</p>
                {/* The same checkboxes, in the same form — plus drag-one-onto-another
                for the two-person case, which is what a phone at the dock wants
                and what ticking boxes is worst at (2026-08-06 review). Ticking
                three still builds a team of three. */}
                <BuddyDragGroups
                  groups={[
                    { heading: t("manifest.buddyDiverGroupLabel"), options: diverOptions },
                    { heading: t("manifest.buddyCrewGroupLabel"), options: crewOptions },
                  ].filter((group) => group.options.length > 0)}
                  copy={{
                    hint: t("manifest.buddyDragHint"),
                    holding: t.raw("manifest.buddyDragHolding"),
                    over: t.raw("manifest.buddyDragOver"),
                  }}
                />
                {/* The action row is where this form's own answer lands — a
                single tick is a worded refusal beside the button that earned
                it, not a floating line at the top of the panel. */}
                <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
                  <button type="submit" className={buttonClass()}>
                    {t("manifest.buddyFormSubmit")}
                  </button>
                  <FormStatus>{builderError}</FormStatus>
                </div>
              </fieldset>
            </form>
          </details>
        ) : unteamedDivers.length === 1 && unteamedDivers[0] ? (
          // An odd roster is normal, never an error — say so instead of
          // rendering a builder that can only fail.
          //
          // Deliberately a bare `<p>` where the sibling branch below is an
          // `EmptyState`, and the difference is not an oversight: that one is a
          // rest state (nobody is left to pair, the slot is finished), while
          // this names a diver who is still on their own. A dashed placeholder
          // card reads as "nothing here", which is the opposite of what this
          // says — somebody is here, and unpaired.
          <p className="mt-3 text-sm text-muted">
            {t("manifest.buddyUnteamedOne", { name: unteamedDivers[0].fullName })}
          </p>
        ) : unteamedDivers.length === 0 && buddyTeamsList.length > 0 ? (
          // The shared empty-section grammar rather than a bare `<p>`
          // (design/principles.md, "Empty states follow one rule"): nobody is
          // left to team up, so the builder's slot has nothing in it.
          // `icon={false}` — this sits nested under the teams list, where the
          // bubbles read as a second, larger empty state than the one line of
          // text warrants.
          <EmptyState icon={false} className="mt-3">
            <p className="text-sm text-muted">{t("manifest.buddyEveryoneTeamed")}</p>
          </EmptyState>
        ) : null}
      </details>
    </section>
  );
}
