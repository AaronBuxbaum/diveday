import Link from "next/link";
import type {
  RollCallAction,
  RollCallButtonCopy,
} from "@/app/shop/[shopSlug]/trips/[id]/_components/RollCallButton";
import { type PrivateNoteAction, PrivateNoteForm } from "@/components/PrivateNoteForm";
import { Badge } from "@/components/ui/badge";
import { buddyAlertText } from "@/i18n/buddy-labels";
import { depthWarningText } from "@/i18n/depth-labels";
import { rollCallCheckpointText, rollCallLabelText } from "@/i18n/manifest-labels";
import { readinessBlockerText } from "@/i18n/readiness-labels";
import { rentalFitLineText } from "@/i18n/rental-labels";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { supportNeedsLines } from "@/i18n/support-needs-labels";
import { formatDateTimeTz, formatShortDate, formatTime } from "@/lib/format";
import {
  type BuddyAlert,
  type BuddyTeammateState,
  type RollCallCheckpoint,
  type RollCallRowState,
  type RollCallTrailEntry,
  rollCallLabel,
  type TripManifest,
} from "@/lib/manifests";
import {
  ROW_DISCLOSURE_PANEL_CLASS,
  RollCallBackAboardControl,
  RollCallExceptionControl,
} from "./RollCallControls";

/**
 * The reference half of a diver's row — emergency contact, rental fit, medical
 * evidence. None of it is roll call: the row's job at the rail is name, state,
 * one tap, and these facts have their moment either before the boat leaves
 * (Prep owns chasing gaps) or when something has gone wrong (one tap away, and
 * always on the paper the boat carries). Rendered twice per row: inside the
 * screen-only person panel, and in a print-only block — a closed `<details>`
 * contributes nothing to print, and the printed manifest is the document a
 * coastguard reads, so it keeps every fact without asking paper to disclose.
 */
export function DiverFacts({
  diver,
  locale,
  timezone,
  columns,
  rosterNames,
  t,
}: {
  diver: TripManifest["divers"][number];
  locale: string;
  timezone: string;
  /**
   * How much width these facts have, which differs by a factor of two between
   * the two places they render — and the answer is not the same in both.
   *
   * `1` is the on-screen panel, inset inside the row: a second column there
   * wrapped "Asha Sharma (sister) · +1-305-555-0231" mid-number.
   *
   * `2` is paper, which has the whole page and no disclosure beside it. Single
   * column there leaves the right half of a US-Letter sheet blank and stretches
   * a nine-diver roster far enough to spill onto another page — more sheets for
   * a boat to carry and lose, to buy width nothing needed.
   */
  columns: 1 | 2;
  /**
   * Every name on this departure, so the "dives with" line can say whether that
   * person is actually on it (issue #1068). Divers and crew both, because a
   * diver may name the divemaster they always pair with.
   */
  rosterNames: readonly string[];
  t: StaffTranslator;
}) {
  const diveSupportLines = supportNeedsLines(t, diver.supportNeeds, rosterNames);
  return (
    <div className={`grid gap-2 text-base${columns === 2 ? " sm:grid-cols-2" : ""}`}>
      <p>
        <span className="font-bold">{t("manifest.emergencyContactLabel")}</span>
        <span className="mt-0.5 block text-muted">
          {diver.emergencyContactName && diver.emergencyContactPhone ? (
            columns === 1 ? (
              <>
                {diver.emergencyContactName} ·{" "}
                {/* Reference text, never a `tel:` link — there are no call
                    buttons anywhere on the boat (ADR
                    20260827-the-departure-is-two-working-surfaces, decision 3):
                    a control that can dial by accident buys nothing on a path
                    used less than once a year and costs a false alarm the one
                    time it misfires.
                    The number never breaks across lines *here*. In the narrow
                    panel it wrapped at its own hyphens — "+1-305-" / "555-0241"
                    — and a number a crew member reads aloud in an emergency is
                    the last string on this page that should be reassembled by
                    eye.
                    Only here: the `<span>` splits one text run into two, which
                    the browser then shapes independently, and on paper that
                    re-drew every phone number a few sub-pixels over for a wrap
                    that a full-width page never had. The printed manifest is
                    the document a coastguard reads — it does not move for a
                    problem it does not have. */}
                <span className="whitespace-nowrap">{diver.emergencyContactPhone}</span>
              </>
            ) : (
              `${diver.emergencyContactName} · ${diver.emergencyContactPhone}`
            )
          ) : (
            t("manifest.notOnFile")
          )}
        </span>
      </p>
      {/* Only when there is something to load or a note to read:
          "No fit on file — not asked yet" printed on most rows
          is the absence of information formatted as information
          (principle 9), and Prep owns chasing the gap. A nitrox
          request always shows — that's an operational fact. */}
      {diver.rentalFit.state !== "not_recorded" || diver.nitroxRequested ? (
        <p>
          <span className="font-bold">{t("manifest.rentalFitLabel")}</span>
          <span className="mt-0.5 block text-muted">
            {rentalFitLineText(t, locale, diver.rentalFit)}
            {diver.nitroxRequested ? t("manifest.nitroxRequestedSuffix") : ""}
          </span>
        </p>
      ) : null}
      {/* What this diver's dive needs set up. Same voice as the rental fit and
          the pickup above it — a fact to plan around, in the muted body tone
          every other marker on this row uses, never a warning. A diver who
          arranged a lift is a diver this shop is ready for (ADR
          20260827-support-needs-are-a-record-about-the-dive).

          Only when something was stated: a line reading "nothing needed" down
          the whole boat is the absence of information formatted as information
          (principle 9). */}
      {diveSupportLines.length > 0 ? (
        <p>
          <span className="font-bold">{t("manifest.supportNeedsLabel")}</span>
          {/* One line per fact, not a joined run — for the reason
              `support-needs-labels.ts` returns a list: two of these carry the
              diver's own free text, and a sentence inside a `·`-joined line is
              where a crew loses track of which fact is which. It matters most
              here, of the two surfaces, because this is the one read at the
              rail. */}
          <span className="mt-0.5 block text-muted">
            {diveSupportLines.map((line) => (
              <span key={line} className="block">
                {line}
              </span>
            ))}
          </span>
        </p>
      ) : null}
      {diver.hotelPickupLocation ? (
        <p>
          <span className="font-bold">{t("manifest.hotelPickupLabel")}</span>
          <span className="mt-0.5 block text-muted">
            {diver.hotelPickupLocation}
            {diver.pickupTime ? ` · ${diver.pickupTime}` : ""}
          </span>
        </p>
      ) : null}
      {diver.medicalWaiver ? (
        <p>
          <span className="font-bold">
            {diver.medicalWaiver.source === "paper"
              ? t("manifest.medicalReviewedPaper")
              : diver.medicalWaiver.source === "imported"
                ? t("manifest.medicalClearanceImported")
                : t("manifest.medicalWaiverSigned")}
          </span>
          <span className="mt-0.5 block text-muted">
            {formatShortDate(diver.medicalWaiver.at, locale, timezone)}
          </span>
        </p>
      ) : null}
    </div>
  );
}

/**
 * Staff notes that belong on a diver's row, rather than in separate desk and
 * diver-record stacks. Booking notes come from the Guests tab; diver notes
 * come from the Diver record and follow the person onto every booking.
 *
 * The crew reading this page should not have to know whether a note was
 * written before a booking existed or for one particular departure. Both are
 * context, and both read here, on the row they are about.
 *
 * The notes list is read-only here, while the form below writes the same
 * booking-scoped record used by Guests. Historical roll-call notes remain on
 * their append-only roll-call event and are still rendered with the result.
 *
 * `print:hidden`, unlike every other fact on this row. The printed manifest is
 * the sheet that goes ashore with the dock and into a coastguard's hands; a
 * note a shop wrote for itself about a customer is not a document either of
 * them asked for, and paper cannot be un-handed.
 */
function StaffNotes({
  notes,
  locale,
  timezone,
  t,
}: {
  notes: ReadonlyArray<ManifestNote>;
  locale: string;
  timezone: string;
  t: StaffTranslator;
}) {
  if (notes.length === 0) return null;
  return (
    <section
      aria-label={t("manifest.diverNotesHeading")}
      className="mt-3 rounded-lg bg-surface px-3 py-2 print:hidden"
    >
      <h3 className="text-sm font-semibold">{t("manifest.diverNotesHeading")}</h3>
      <ul className="mt-1 flex flex-col gap-1.5">
        {notes.map((entry) => (
          <li key={entry.id} className="break-words text-base whitespace-pre-wrap">
            {entry.body}
            <span className="ms-1 text-sm text-muted">
              — {entry.authorName} · {formatDateTimeTz(entry.createdAt, locale, timezone)}
              {entry.scope === "diver" ? ` · ${t("manifest.noteAppliesAcrossDepartures")}` : ""}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** One staff note, flattened to what this page renders. */
export type ManifestNote = {
  id: string;
  body: string;
  authorName: string;
  createdAt: Date;
  scope: "booking" | "diver";
};

/**
 * What a human has actually said about this diver today, in checkpoint order.
 *
 * The sheet\'s first section, because the first question asked of a person on a
 * boat is "where have they been counted?" — and the row above can only carry
 * the *current* checkpoint\'s answer. On the surface interval after dive two,
 * "Boarded · before departure · 6:51 · Dana" is the line that says this diver
 * did leave the dock, which no other pixel on the screen states any more.
 *
 * **Only recorded results.** A carried-forward result is the carry-forward
 * rule speaking, not a person: it has no time and no recorder, and one
 * statement rendered once per later checkpoint would read as four. The row\'s
 * own "Ashore since the dock" already says a result was carried.
 *
 * Renders nothing when nobody has said anything yet. A "nothing recorded"
 * line is the absence of information formatted as information (principle 9),
 * and at the dock — the one checkpoint where an empty trail is the norm — it
 * would print under every name on the boat.
 */
function TodayTrail({
  trail,
  locale,
  timezone,
  t,
}: {
  trail: readonly RollCallTrailEntry[];
  locale: string;
  timezone: string;
  t: StaffTranslator;
}) {
  if (trail.length === 0) return null;
  return (
    <section className="mb-3">
      <h3 className="text-sm font-semibold">{t("manifest.personSheet.todayHeading")}</h3>
      {/* The name is on the list, not on the `<section>`: a crew member
          navigating by landmark wants "Today, list, 2 items", and a region
          wrapping an unnamed list makes the list itself unaddressable. */}
      <ol
        aria-label={t("manifest.personSheet.todayHeading")}
        className="mt-1 flex flex-col gap-1.5"
      >
        {trail.map((entry) => (
          <li key={entry.checkpoint} className="text-base">
            <span className="block">
              {t("manifest.personSheet.trailAt", {
                label: rollCallLabelText(t, rollCallLabel(entry.checkpoint, entry.record)),
                checkpoint: rollCallCheckpointText(t, entry.checkpoint),
              })}
            </span>
            {/* Time, not a timestamp — every roll call for a departure happens
                on that departure\'s own day. The date is on paper, where a
                sheet may be read months later. */}
            <span className="block text-sm text-muted">
              {t("manifest.personSheet.trailWho", {
                time: formatTime(entry.record.occurredAt, locale, timezone),
                name: entry.record.recordedByName,
              })}
            </span>
            {entry.record.note ? (
              <span className="mt-0.5 block text-sm">{entry.record.note}</span>
            ) : null}
          </li>
        ))}
      </ol>
    </section>
  );
}

/**
 * Who this diver is supposed to be with, and **where each of them is** — the
 * sheet\'s buddy states (ADR 20260827-the-departure-is-two-working-surfaces,
 * decision 2).
 *
 * The row above can only carry a team *label*, and its one capsule can only
 * carry the alert. Neither names the person behind it, which is the whole of
 * what a crew member wants at the rail: not "team split" but "Chinwe is
 * aboard, Georg has been ashore since the dock." Each teammate wears the word
 * their own row wears (`buddyTeammateStatesIn` resolves it), so the two
 * readings of one fact cannot disagree.
 *
 * **Alarm vocabulary only for a recorded fact** (decision 4): a teammate is
 * quiet muted text unless a human has recorded them not back aboard, which is
 * the one state that earns the danger tone here. A team whose members are all
 * simply uncalled mid-count renders as calm as it should.
 */
function BuddyStates({
  states,
  alert,
  t,
}: {
  states: readonly BuddyTeammateState[];
  alert: BuddyAlert | null;
  t: StaffTranslator;
}) {
  if (states.length === 0) return null;
  return (
    <section className="mb-3">
      <h3 className="text-sm font-semibold">
        {t("manifest.personSheet.buddyHeading")}
        {alert ? (
          <span className="ms-2 align-middle">
            <Badge tone={alert === "separated_after_dive" ? "danger" : "warning"}>
              {buddyAlertText(t, alert)}
            </Badge>
          </span>
        ) : null}
      </h3>
      <ul aria-label={t("manifest.personSheet.buddyHeading")} className="mt-1 flex flex-col gap-1">
        {states.map((mate) => (
          <li
            key={mate.kind === "diver" ? mate.bookingId : mate.personId}
            className="flex flex-wrap items-baseline gap-x-2 text-base"
          >
            <span>{mate.fullName}</span>
            {mate.label === "not_back_aboard" ? (
              <Badge tone="danger">{rollCallLabelText(t, mate.label)}</Badge>
            ) : (
              <span className="text-sm text-muted">{rollCallLabelText(t, mate.label)}</span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * Everything about one diver that the rail does not need this second — the
 * **"one tap away" tier** of ADR 20260827-the-departure-is-two-working-surfaces,
 * decision 2, opened by tapping the person's own name on their roll-call row.
 *
 * Two rules govern what may appear here, and both are the ADR\'s:
 *
 * **There are no call buttons anywhere on the boat** (decision 3). The
 * emergency contact renders as reference text and the sheet contains no
 * `tel:`/`sms:` href and no dial control, because a control that can dial by
 * accident buys nothing on a path used less than once a year and costs a false
 * alarm the one time it misfires. `PersonSheet.test.tsx` fails on any element
 * in this subtree that could place a call.
 *
 * **The deliberate second step lives here and nowhere else** (decision 3
 * again). Recording a diver not back aboard is the highest-consequence claim
 * this app can make, so reaching it costs a tap on the person\'s name first —
 * it is never on the row, where a wet thumb runs down a list.
 *
 * Paper is unaffected: a closed `<details>` contributes nothing to print, so
 * the printed manifest restates every fact behind this tap unconditionally
 * (`DiverRollCall`\'s print block). Screens hide; the sheet that goes ashore
 * never does.
 */
export function PersonSheet({
  diver,
  checkpoint,
  isDeparture,
  rowState,
  ready,
  shopSlug,
  tripId,
  locale,
  timezone,
  rosterNames,
  sharedAdvisoryTexts,
  notes,
  capsuleKind,
  rollCallAction,
  addPrivateNoteAction,
  rollCallButtonCopy,
  t,
}: {
  diver: TripManifest["divers"][number];
  checkpoint: RollCallCheckpoint;
  isDeparture: boolean;
  rowState: RollCallRowState;
  ready: boolean;
  shopSlug: string;
  tripId: string;
  locale: string;
  timezone: string;
  rosterNames: readonly string[];
  /**
   * The depth advisories the list already states once by name, above the
   * roster. A diver whose advisory is in that set does not repeat it here.
   */
  sharedAdvisoryTexts: ReadonlySet<string>;
  notes: ReadonlyArray<ManifestNote>;
  /** Which exception the row\'s single capsule spent itself on, so this sheet says the others. */
  capsuleKind: "buddy" | "blocked" | "minor" | "depth" | "birthday" | null;
  rollCallAction: RollCallAction;
  addPrivateNoteAction: PrivateNoteAction;
  rollCallButtonCopy: RollCallButtonCopy;
  t: StaffTranslator;
}) {
  const rc = diver.rollCall;
  return (
    <div className={ROW_DISCLOSURE_PANEL_CLASS}>
      {/* Today first, then the team: the two questions a crew member opens a
          person for are "where has this one been counted?" and "who are they
          supposed to be with, and where are those people?". Everything below
          — blockers, the advisory, contact, notes — is reference they came to
          the sheet already knowing they wanted. */}
      <TodayTrail trail={diver.trail ?? []} locale={locale} timezone={timezone} t={t} />
      <BuddyStates states={diver.buddyStates} alert={diver.buddyAlert} t={t} />
      {/* Blockers, and their one fix, at the dock only. After a
        dive readiness gates nothing — the diver is already
        aboard — so a red list here would be worrying about a
        paperwork state at the checkpoint where the only thing
        that matters is bodies (decision 4). The count panel
        still says the follow-up happens ashore. */}
      {!ready && isDeparture ? (
        <>
          <ul className="flex flex-col gap-1 text-base text-danger">
            {/* Keyed on the sentence, not the code: a trip
              requiring two specialties yields two blockers with
              one code and different params. */}
            {diver.readiness.blockers.map((blocker) => {
              const text = readinessBlockerText(t, blocker);
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
            href={`/shop/${shopSlug}/trips/${tripId}/guests#booking-${diver.bookingId}`}
            className="mt-2 inline-flex min-h-11 items-center text-base font-semibold text-primary hover:underline"
          >
            {t("manifest.resolveBlockersLink")}
          </Link>
          <hr className="my-3 border-border" />
        </>
      ) : null}
      {/* A diver whose advisory the strip above does not already
        state by name keeps the full sentence — here, where the
        plan for dive two is read during the surface interval.
        Warning tone, never a gate (H-08). */}
      {diver.depthAdvisory?.status === "exceeds" &&
      !sharedAdvisoryTexts.has(depthWarningText(t, diver.depthAdvisory)) ? (
        <p className="mb-3 flex gap-2 rounded-lg bg-warning-tint px-3 py-2 text-base text-warning-strong">
          <span aria-hidden="true">▲</span>
          <span>{depthWarningText(t, diver.depthAdvisory)}</span>
        </p>
      ) : null}
      <DiverFacts
        diver={diver}
        locale={locale}
        timezone={timezone}
        columns={1}
        rosterNames={rosterNames}
        t={t}
      />
      {/* The facts the row's one capsule could not carry — who
        this diver is paired with, the counter's arrival, the age
        the crew is entitled to know. Quiet, in words, one tap
        away: a team label is not an exception, so it does not
        earn the row's single capsule, but "who am I supposed to
        be with?" is a question asked at the rail and the answer
        has to be on the screen as well as on paper. */}
      <ul className="mt-3 flex flex-wrap gap-2">
        {diver.checkedIn ? (
          <li>
            <Badge tone="neutral">{t("manifest.checkedInPill")}</Badge>
          </li>
        ) : null}
        {/* The age, and — when something louder took the row's
          one capsule — **the minor flag with it**. A blocked
          diver and a split team are exactly the cases where a
          13-year-old is most likely to be on the row that lost
          it, and the captain reading the boarding list has no
          other way to know a booked diver is 12 (H-21). Gated
          on which capsule the row actually rendered, never on
          `minor` itself (dive-domain review, slice 5a). */}
        {diver.age !== null && diver.age !== undefined && capsuleKind !== "minor" ? (
          <li>
            <Badge tone={diver.minor ? "warning" : "neutral"} tabularNums>
              {diver.minor
                ? t("manifest.minorAge", { age: diver.age })
                : t("manifest.age", { age: diver.age })}
            </Badge>
          </li>
        ) : null}
      </ul>
      <StaffNotes notes={notes} locale={locale} timezone={timezone} t={t} />
      {/* `print:hidden` like the notes above it: an unsaved
        sentence a staffer was mid-way through typing about a
        customer is the last thing that should ride the sheet
        that goes ashore, and the packet's own stylesheet only
        covers the packet (security review, slice 5a). */}
      <div className="mt-3 print:hidden">
        <PrivateNoteForm
          action={addPrivateNoteAction}
          hiddenFields={{ bookingId: diver.bookingId }}
          resetKey={notes.filter((note) => note.scope === "booking").length}
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
      {rowState.notBackAboard ? (
        <RollCallBackAboardControl
          kind="diver"
          subjectId={diver.bookingId}
          checkpoint={checkpoint}
          subjectName={diver.fullName}
          action={rollCallAction}
          copy={rollCallButtonCopy}
          t={t}
        />
      ) : null}
      {/* The deliberate second step. It is here, and nowhere
        else on this page, because reaching it has to cost a
        tap on the person's own name first (decision 3). */}
      <RollCallExceptionControl
        kind="diver"
        subjectId={diver.bookingId}
        checkpoint={checkpoint}
        isDeparture={isDeparture}
        rollCall={rc}
        action={rollCallAction}
        copy={rollCallButtonCopy}
        t={t}
      />
    </div>
  );
}
