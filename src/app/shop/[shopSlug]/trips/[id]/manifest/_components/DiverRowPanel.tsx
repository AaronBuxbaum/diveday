import Link from "next/link";
import { MedicalAlertReveal } from "@/components/MedicalAlertReveal";
import { PrivateNoteForm } from "@/components/PrivateNoteForm";
import { Badge } from "@/components/ui/badge";
import { StatusMark } from "@/components/ui/StatusMark";
import { depthWarningText } from "@/i18n/depth-labels";
import type { TripManifest } from "@/lib/manifests";
import { shopPath } from "@/lib/staff-notices";
import { DiverFacts, diverBlockerText } from "./DiverFacts";
import type { DiverRollCallContext } from "./diver-roll-call-context";
import type { DiverRowState } from "./diver-row-state";
import { medicalAlertView } from "./medical-alert-view";
import { MissingDiverControls } from "./missing-diver-controls";
import {
  ROW_DISCLOSURE_PANEL_CLASS,
  RollCallBackAboardControl,
  RollCallExceptionControl,
} from "./RollCallControls";
import { type ManifestNote, StaffNotes } from "./StaffNotes";

/**
 * **The person sheet's panel** — everything the rail does not need this
 * second, one tap away (decision 2): the blockers and their one fix at the
 * dock, a depth advisory the shared strip does not already name, the contact
 * facts, the quiet pills, the staff notes and the note form, and the two
 * deliberate roll-call steps that may never sit on the row (decision 3).
 */
export function DiverRowPanel({
  context,
  diver,
  state,
  sharedAdvisoryTexts,
  bookingNotes,
}: {
  context: DiverRollCallContext;
  diver: TripManifest["divers"][number];
  state: DiverRowState;
  /** The advisories the strip above the list already states by name. */
  sharedAdvisoryTexts: ReadonlySet<string>;
  bookingNotes: ReadonlyArray<ManifestNote>;
}) {
  const {
    checkpoint,
    isDeparture,
    shopSlug,
    tripId,
    locale,
    timezone,
    rollCallAction,
    addPrivateNoteAction,
    missingDiver,
    rollCallButtonCopy,
    rollCallClosed,
    showMedicalAlert,
    emergencyShowMedicalAlert,
    t,
  } = context;
  const { rc, rowState, blockedAtDock, capsuleKind, medicalHoldInPanel } = state;
  // No box round the whole panel any more (visual review 2026-10-24, B08):
  // the emergency contact alone sits in the card, and the one roll-call step
  // stands at the sheet's foot, outside it.
  return (
    <div>
      {/* Blockers, and their one fix, at the dock only. After a
        dive readiness gates nothing — the diver is already
        aboard — so a red list here would be worrying about a
        paperwork state at the checkpoint where the only thing
        that matters is bodies (decision 4). The count panel
        says nothing about it either, for the same reason. */}
      {blockedAtDock ? (
        <>
          <ul className="flex flex-col gap-1 text-base text-danger">
            {/* Keyed on the sentence, not the code: a trip
              requiring two specialties yields two blockers with
              one code and different params. */}
            {diver.readiness.blockers.map((blocker) => {
              const text = diverBlockerText(t, diver, blocker);
              return <li key={text}>• {text}</li>;
            })}
          </ul>
          {/* The Guests ledger groups its blocked divers under
            "Still to clear" at the top of the list (ADR
            20260827-the-departure-is-two-working-surfaces,
            slice 5d), so the anchor alone lands the captain on
            this diver's row with the group band saying why —
            the `?rf=blocked` filter this link used to carry is
            retired with the chips. */}
          <Link
            href={`/shop/${shopSlug}/trips/${tripId}#booking-${diver.bookingId}`}
            className="mt-2 inline-flex min-h-11 items-center text-base font-semibold text-primary hover:underline"
          >
            {t("manifest.resolveBlockersLink")}
          </Link>
          {/* **Even by ink, not by box** (pixel-craft class
            4). The link above is a 44px target round a 24px
            line, so about 15px of its box is already air under
            its words; a `my-3` rule added 12px more, 27px of
            ink to rule against 18 from the rule to the next
            line. The link's own air is the space above, so
            the rule's margin is below only. */}
          <hr className="mt-0 mb-3 border-border" />
        </>
      ) : null}
      {/* **A medical hold the capsule lost** (#2380): after a dive, a
        diver boarded over a medical blocker whose row went to a
        louder fact keeps the blocker's sentence here. Warning tone
        like the capsule it would have worn — the red is the dock's
        and the alarm's, and after a dive readiness gates nothing. */}
      {medicalHoldInPanel ? (
        <ul className="mb-3 flex flex-col gap-1 rounded-lg bg-warning-tint px-3 py-2 text-base text-warning-strong">
          {diver.readiness.blockers
            .filter((blocker) => blocker.code === medicalHoldInPanel)
            .map((blocker) => {
              const text = diverBlockerText(t, diver, blocker);
              return (
                <li key={text} className="flex gap-2">
                  <StatusMark variant="warning" size="md" />
                  <span>{text}</span>
                </li>
              );
            })}
        </ul>
      ) : null}
      {/* A diver whose advisory the strip above does not already
        state by name keeps the full sentence — here, where the
        plan for dive two is read during the surface interval.
        Warning tone, never a gate (H-08). */}
      {(diver.depthAdvisory?.status === "exceeds" ||
        diver.depthAdvisory?.status === "verification_required") &&
      !sharedAdvisoryTexts.has(depthWarningText(t, diver.depthAdvisory)) ? (
        <p className="mb-3 flex gap-2 rounded-lg bg-warning-tint px-3 py-2 text-base text-warning-strong">
          <StatusMark variant="warning" size="md" />
          <span>{depthWarningText(t, diver.depthAdvisory)}</span>
        </p>
      ) : null}
      {/* **The diver's medical alert for the crew** (issue #2960, H-153),
        above the contact facts it sits beside in an emergency: the words
        behind a recorded tap for the owner, a manager and crew a manager put
        on this departure, and for anyone else who can read them and whom to
        ask. Never on a held seat. */}
      {diver.medicalAlert && !diver.identityWithheld ? (
        <section className="mb-3 flex flex-col gap-2 rounded-lg bg-primary-tint px-3 py-2">
          <h3 className="text-base font-semibold text-primary">
            {t("manifest.medicalAlertHeading")}
          </h3>
          <MedicalAlertReveal
            {...medicalAlertView({
              show: showMedicalAlert?.(diver.bookingId),
              emergencyShow: emergencyShowMedicalAlert?.(diver.bookingId),
              tripId,
              bookingId: diver.bookingId,
              t,
            })}
          />
        </section>
      ) : null}
      <DiverFacts
        diver={diver}
        locale={locale}
        timezone={timezone}
        columns={1}
        contactClassName={ROW_DISCLOSURE_PANEL_CLASS}
        waiverHref={(record) =>
          shopPath(shopSlug, "divers", record.personId, "waivers", record.recordId)
        }
        t={t}
      />
      {/* The facts the row's one capsule could not carry — who
        this diver is paired with, the counter's arrival, the age
        the crew is entitled to know. Quiet, in words, one tap
        away: a team label is not an exception, so it does not
        earn the row's single capsule, but "who am I supposed to
        be with?" is a question asked at the rail and the answer
        has to be on the screen as well as on paper.

        `empty:hidden` because every item is conditional: a
        diver with neither rendered the list empty, and its
        `mt-3` stood on the note form's, 24px where the panel's
        blocks sit 12 apart (pixel-craft class 4). */}
      <ul className="mt-3 flex flex-wrap gap-2 empty:hidden">
        {diver.checkedIn ? (
          <li>
            <Badge tone="neutral">{t("manifest.checkedInPill")}</Badge>
          </li>
        ) : null}
        {/* **The minor flag**, when something louder took the row's one
          capsule. A blocked diver and a split team are exactly the cases
          where a 13-year-old is most likely to be on the row that lost it,
          and the captain reading the boarding list has no other way to know
          a booked diver is 12 (H-21). Gated on which capsule the row
          actually rendered, never on `minor` itself (dive-domain review,
          slice 5a). An adult's age is in the subtitle, so the lone "Age 27"
          chip is gone (B08). */}
        {diver.minor && diver.age !== null && diver.age !== undefined && capsuleKind !== "minor" ? (
          <li>
            <Badge tone="warning" tabularNums>
              {t("manifest.minorAge", { age: diver.age })}
            </Badge>
          </li>
        ) : null}
      </ul>
      <StaffNotes notes={bookingNotes} locale={locale} timezone={timezone} t={t} />
      {/* `print:hidden` like the notes above it: an unsaved
        sentence a staffer was mid-way through typing about a
        customer is the last thing that should ride the sheet
        that goes ashore, and the packet's own stylesheet only
        covers the packet (security review, slice 5a). */}
      <div className="mt-3 print:hidden">
        <PrivateNoteForm
          action={addPrivateNoteAction}
          hiddenFields={{ bookingId: diver.bookingId }}
          resetKey={bookingNotes.filter((note) => note.scope === "booking").length}
          rows={2}
          copy={{
            label: t("trips.roster.addNoteLabel"),
            placeholder: t("trips.roster.addNotePlaceholder"),
            add: t("trips.roster.addPrivateNote"),
            adding: t("trips.roster.adding"),
          }}
        />
      </div>
      {/* Both directions out of a stated "not back aboard", at
        the same cost: "Mark back aboard" here, and the
        retraction on the settled control below it. Neither is
        on the row (ADR 20260815-offline-can-unsay-a-missing-diver
        — retracting a mark may never be harder than making
        one, and asserting aboard over a missing mark is not a
        thumb-under-a-list act). */}
      {/* No roll-call control at all on a closed cancelled departure (#2285). */}
      {rowState.notBackAboard && !rollCallClosed ? (
        <RollCallBackAboardControl
          kind="diver"
          subjectId={diver.bookingId}
          checkpoint={checkpoint}
          subjectName={diver.fullName}
          action={rollCallAction}
          copy={rollCallButtonCopy(diver.bookingId)}
          t={t}
        />
      ) : null}
      {/* **The owners told now, and the report, from the row that raised
        it** (safety sheet 2026-10-15, item 2; issue #2694): the alert and the
        one report for this missing diver while marked not back aboard, and
        Found once marked back. Only for those who may start a report. */}
      <MissingDiverControls
        actions={missingDiver}
        notBackAboard={rowState.notBackAboard}
        subject={{ field: "bookingId", id: diver.bookingId }}
        name={diver.fullName}
        checkpoint={checkpoint}
        t={t}
      />
      {/* The deliberate second step. It is here, and nowhere
        else on this page, because reaching it has to cost a
        tap on the person's own name first (decision 3). */}
      {rollCallClosed ? null : (
        <RollCallExceptionControl
          kind="diver"
          subjectId={diver.bookingId}
          checkpoint={checkpoint}
          isDeparture={isDeparture}
          rollCall={rc}
          action={rollCallAction}
          copy={rollCallButtonCopy(diver.bookingId)}
          t={t}
        />
      )}
    </div>
  );
}
