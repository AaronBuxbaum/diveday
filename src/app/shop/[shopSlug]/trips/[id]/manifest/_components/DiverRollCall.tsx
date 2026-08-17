import Link from "next/link";
import type {
  RollCallAction,
  RollCallButtonCopy,
} from "@/app/shop/[shopSlug]/trips/[id]/_components/RollCallButton";
import { type PrivateNoteAction, PrivateNoteForm } from "@/components/PrivateNoteForm";
import { Badge } from "@/components/ui/badge";
import { sectionCardClass } from "@/components/ui/card";
import { DisclosureCaret } from "@/components/ui/DisclosureCaret";
import { birthdayText } from "@/i18n/birthday-labels";
import { buddyAlertText } from "@/i18n/buddy-labels";
import { depthWarningText } from "@/i18n/depth-labels";
import { rollCallCheckpointText, rollCallLabelText } from "@/i18n/manifest-labels";
import {
  readinessBlockerText,
  readinessStatusText,
  readinessStatusTone,
} from "@/i18n/readiness-labels";
import { rentalFitLineText } from "@/i18n/rental-labels";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { formatDateTimeTz, formatShortDate } from "@/lib/format";
import {
  type ManifestBuddyTeam,
  type RollCallCheckpoint,
  rollCallLabel,
  type TripManifest,
} from "@/lib/manifests";
import { BuddyTeamChip } from "./BuddyTeamChip";
import {
  ROLL_CALL_ROW_TONE,
  RollCallControls,
  rollCallRecordedTone,
  rollCallRowState,
  rollCallScrollMargin,
} from "./RollCallControls";

/**
 * The reference half of a diver's row — emergency contact, rental fit, medical
 * evidence. None of it is roll call: the row's job at the rail is name, state,
 * one tap, and these facts have their moment either before the boat leaves
 * (Prep owns chasing gaps) or when something has gone wrong (one tap away, and
 * always on the paper the boat carries). Rendered twice per row: inside the
 * screen-only disclosure, and in a print-only block — a closed `<details>`
 * contributes nothing to print, and the printed manifest is the document a
 * coastguard reads, so it keeps every fact without asking paper to disclose.
 */
function DiverFacts({
  diver,
  locale,
  timezone,
  columns,
  t,
}: {
  diver: TripManifest["divers"][number];
  locale: string;
  timezone: string;
  /**
   * How much width these facts have, which differs by a factor of two between
   * the two places they render — and the answer is not the same in both.
   *
   * `1` is the on-screen disclosure, one of two panels sharing the row's
   * width: a second column there wrapped "Asha Sharma (sister) ·
   * +1-305-555-0231" mid-number.
   *
   * `2` is paper, which has the whole page and no disclosure beside it. Single
   * column there leaves the right half of a US-Letter sheet blank and stretches
   * a nine-diver roster far enough to spill onto another page — more sheets for
   * a boat to carry and lose, to buy width nothing needed.
   */
  columns: 1 | 2;
  t: StaffTranslator;
}) {
  return (
    <div className={`grid gap-2 text-base${columns === 2 ? " sm:grid-cols-2" : ""}`}>
      <p>
        <span className="font-bold">{t("manifest.emergencyContactLabel")}</span>
        <span className="mt-0.5 block text-muted">
          {diver.emergencyContactName && diver.emergencyContactPhone ? (
            columns === 1 ? (
              <>
                {diver.emergencyContactName} ·{" "}
                {/* The number never breaks across lines *here*. In the
                    half-width panel it wrapped at its own hyphens — "+1-305-"
                    / "555-0241" — and a number a crew member reads aloud in an
                    emergency is the last string on this page that should be
                    reassembled by eye.
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
 * The two disclosures a diver's row carries — "Contact & gear" and "Add a
 * note" — as one set of class strings.
 *
 * **Side by side, and the summary never moves.** They used to stack, which cost
 * the row a second 44px line for a control most roll calls never touch; they
 * are peers, so they share one line and each panel opens down its own grid
 * column (an `auto`-flowed row would have pushed the neighbour sideways as one
 * opened). And the panel treatment belongs to the *panel*: hung on the
 * `<details>` as `open:` variants it grew the element's own margin and padding
 * at the instant of the tap, so the summary line jumped ~20px down the screen
 * out from under the finger that opened it.
 */
const ROW_DISCLOSURE_GRID_CLASS =
  "mt-1 grid items-start gap-x-6 print:hidden sm:max-w-4xl sm:grid-cols-2";
const ROW_DISCLOSURE_SUMMARY_CLASS =
  "group/summary flex min-h-11 w-fit cursor-pointer list-none items-center gap-2 text-base font-medium text-muted select-none hover:text-primary [&::-webkit-details-marker]:hidden";
const ROW_DISCLOSURE_PANEL_CLASS =
  "mb-1 rounded-xl border border-border/70 bg-surface-sunken/50 p-3";

/**
 * Staff notes that belong on a diver's row, rather than in separate desk and
 * diver-record stacks. Booking notes come from the Guests tab; diver notes
 * come from the Diver record and follow the person onto every booking.
 *
 * The crew reading this page should not have to know whether a note was
 * written before a booking existed or for one particular departure. Both are
 * context, and both read here, on the row they are about.
 *
 * The notes list is read-only here, while the collapsed form below writes the
 * same booking-scoped record used by Guests. Historical roll-call notes remain
 * on their append-only roll-call event and are still rendered with the result.
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
      className="mt-3 rounded-lg bg-surface-sunken px-3 py-2 print:hidden"
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

/** The diver half of the head count — every active booking, one row each. */
export function DiverRollCall({
  divers,
  checkpoint,
  isDeparture,
  shopSlug,
  tripId,
  locale,
  timezone,
  notesByBooking,
  rollCallAction,
  addPrivateNoteAction,
  rollCallButtonCopy,
  buddyTeamLabel,
  t,
}: {
  divers: TripManifest["divers"];
  checkpoint: RollCallCheckpoint;
  isDeparture: boolean;
  shopSlug: string;
  tripId: string;
  locale: string;
  timezone: string;
  /** All staff context for this booking, regardless of where it was written. */
  notesByBooking: ReadonlyMap<string, ReadonlyArray<ManifestNote>>;
  rollCallAction: RollCallAction;
  addPrivateNoteAction: PrivateNoteAction;
  /**
   * One `RollCallButtonCopy` per diver: the "not ready" refusal embeds a rich
   * link to that diver's own Guests anchor, so it is built by the page
   * (server-side, with `t.rich`) rather than reassembled from string fragments
   * in the Client Component — see the note on `RollCallButtonCopy`.
   */
  rollCallButtonCopy: (bookingId: string) => RollCallButtonCopy;
  buddyTeamLabel: (teams: ReadonlyArray<ManifestBuddyTeam>) => string | null;
  t: StaffTranslator;
}) {
  return (
    <section id="roll-call-list" tabIndex={-1} className="mt-9 outline-none">
      {/* No "Shop time: Eastern Daylight Time" beside the heading. Every time
          on this page is already the shop's own — that is the app's rule
          everywhere (`shops.timezone`, `pnpm check:timezone`), not a property
          of this screen — and a crew reading a roll call at their own dock has
          no second zone to confuse it with. It named the one thing on the page
          nobody was in doubt about. */}
      <div>
        <h2 className="text-lg font-semibold">
          {t("manifest.checkpointRollCallHeading", {
            checkpoint: rollCallCheckpointText(t, checkpoint),
          })}
        </h2>
        {/* The control that isn't "Boarded" means something different once
            the boat is out, and the crew tapping it in the dark should be
            told which one they are looking at (DOM-H3). */}
        {isDeparture ? null : (
          <p className="mt-1 max-w-prose text-base font-semibold text-warning-strong">
            {t("manifest.notBackAboardDescription")}
          </p>
        )}
      </div>
      <ul
        className={sectionCardClass({ padding: "none", className: "mt-4 divide-y divide-border" })}
      >
        {divers.map((diver, index) => {
          const diverStatus = diver.readiness.status;
          const ready = diverStatus === "ready";
          const rc = diver.rollCall;
          // One derivation of what a roll-call record means, shared with the
          // crew list and the button stack (`rollCallRowState`). `recordedHere`
          // is whether a human has said something about this diver *at this
          // checkpoint* — the two buttons already carry that answer in words,
          // so the status pill would only repeat them.
          const rowState = rollCallRowState(checkpoint, rc);
          const { impliedNotBoarded, recordedHere } = rowState;
          // Each roll-call state gets its own fill (`ROLL_CALL_ROW_TONE`) so
          // staff can tell at a glance who has been handled — aboard green,
          // left ashore amber, not back aboard red, nothing said yet slate.
          //
          // Untouched rows are where the diver list differs from the crew's: at
          // the dock a blocked diver's readiness *is* the thing to fix before
          // they board, so the row says so. After a dive it is not — roll call
          // there is a physical head count that readiness never gates, and a
          // danger-tinted row for a paperwork state would compete with the one
          // red on the page that means somebody is in the water (DD9).
          const recordedTone = rollCallRecordedTone(rowState);
          const untouchedTone =
            ready || !isDeparture ? ROLL_CALL_ROW_TONE.awaiting : ROLL_CALL_ROW_TONE.blocked;
          // Every row is a jump target — the summary panel's chips link to any
          // uncalled person — so every row carries the scroll margin that keeps
          // its name clear of the sticky checkpoint panel. Shared with the crew
          // rows, which are jump targets for the same chips: see
          // `rollCallScrollMargin` for what the two sizes are measured against.
          const rowClass = `border-l-4 px-4 py-5 sm:px-5 ${rollCallScrollMargin(isDeparture)} ${
            recordedTone ? ROLL_CALL_ROW_TONE[recordedTone] : untouchedTone
          }`;
          // The pill is dropped only when something else on the row is
          // already saying the same word. Two cases where nothing is
          // (dive-domain review 20260804):
          //
          //  - **On paper.** The button column is `print:hidden`, so on the
          //    document the boat actually carries, deleting the pill would
          //    move every diver's status to a muted audit line at the foot of
          //    their row. It stays, screen-hidden and print-visible.
          //  - **When the board button isn't rendered.** It only appears for
          //    `ready || !isDeparture`, so a diver boarded at departure whose
          //    readiness later flipped to blocked would show a green row, a
          //    red "Blocked" badge, a lone "Mark not boarded" button, and
          //    nothing anywhere near their name saying they are aboard.
          const boardingControlShown = ready || !isDeparture;
          // An untouched row's pill repeats a control too: an un-tapped "Mark
          // boarded" beside the name already says nothing has been recorded,
          // so "Awaiting roll call" on the same line is the affordance
          // restated as a badge (principle 9). The carried-forward pill stays
          // — no control on the row says "not boarded at the dock".
          const pillRepeatsAControl = (recordedHere || !rc) && boardingControlShown;
          // Not a Badge: "carried forward from the dock" needs a fill of its
          // own, a distinction the app's five standard Badge tones don't carry.
          const rollCallPillClass = impliedNotBoarded
            ? "rounded-full bg-warning/15 px-3 py-1 text-sm font-medium text-warning-strong"
            : "rounded-full bg-surface px-3 py-1 text-sm font-medium text-muted";
          return (
            <li
              key={diver.bookingId}
              id={`diver-row-${diver.bookingId}`}
              className={`${rowClass} transition-all duration-300`}
            >
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                {/* `lg:flex-1` so this column is the same width on every row.
                    Left to size itself, a flex child takes its content's width
                    — and since the row's content is a name plus however many
                    badges that diver happens to carry, every row got a
                    different one. The two disclosures below split this column
                    in half, so "Add a note" then started at a different x on
                    each of nine rows, wandering left and right down the
                    roster. */}
                <div className="min-w-0 lg:flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-surface-sunken text-sm font-bold tabular-nums">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <h3 className="text-lg font-semibold">{diver.fullName}</h3>
                    {/* The one readiness vocabulary (src/i18n/readiness-labels.ts).
                        The manifest is where "Blocked" was already the word,
                        which is why it is the word everywhere now. Only the
                        exception is worth a chip: a "Ready" badge on most of
                        a healthy roster is noise that makes the two rows that
                        are *not* ready harder to find, and the blocker list
                        below already spells out why. */}
                    {ready ? null : (
                      <Badge tone={readinessStatusTone(diverStatus)}>
                        {readinessStatusText(t, diverStatus)}
                      </Badge>
                    )}
                    {/* Counter check-in and boat roll call are different
                        questions — arrived vs. aboard — and `checked_in`
                        used to have exactly one reader in the app, the
                        check-in page itself (task 149, UX persona lens 17).
                        This is informational only: it never gates roll
                        call. */}
                    {diver.checkedIn ? (
                      <Badge tone="neutral">{t("manifest.checkedInPill")}</Badge>
                    ) : null}
                    {/* The captain reading the boarding list has no other way
                        to know a booked diver is 12 (H-21). Words, not colour
                        alone — this is read in sunlight on a moving boat. An
                        *adult's* age is a fact, not a flag: on screen it was a
                        chip repeating down the whole roster (principle 9), so
                        it now shows on paper only, where the manifest is the
                        record. The minor badge stays on screen — it is the
                        exception the crew is being told about. */}
                    {diver.age !== null && diver.age !== undefined ? (
                      diver.minor ? (
                        <Badge tone="warning" tabularNums>
                          {t("manifest.minorAge", { age: diver.age })}
                        </Badge>
                      ) : (
                        <span className="hidden print:inline-flex">
                          <Badge tone="neutral" tabularNums>
                            {t("manifest.age", { age: diver.age })}
                          </Badge>
                        </span>
                      )
                    ) : null}
                    {diver.birthday ? (
                      <Badge tone="primary">
                        <span aria-hidden="true">🎂</span>
                        <span className="sr-only">{t("shared.birthday.label")}</span>
                        <span className="ms-1">{birthdayText(t, diver.birthday)}</span>
                      </Badge>
                    ) : null}
                    <span
                      className={
                        pillRepeatsAControl
                          ? `hidden print:inline-flex ${rollCallPillClass}`
                          : rollCallPillClass
                      }
                    >
                      {rollCallLabelText(t, rollCallLabel(checkpoint, rc))}
                    </span>
                    <BuddyTeamChip
                      label={buddyTeamLabel(diver.buddyTeam ? [diver.buddyTeam] : [])}
                      alertText={diver.buddyAlert ? buddyAlertText(t, diver.buddyAlert) : null}
                      alert={diver.buddyAlert}
                    />
                  </div>
                  {/* The plan for dive two is made here, on the boat, during
                      the surface interval — so the depth advisory has to be
                      here too, not only on the desk-side roster. Warning
                      tone, never a gate (H-08). */}
                  {diver.depthAdvisory?.status === "exceeds" ? (
                    <p className="mt-2 flex gap-2 rounded-lg bg-warning/10 px-3 py-2 text-base text-warning-strong">
                      <span aria-hidden="true">▲</span>
                      <span>{depthWarningText(t, diver.depthAdvisory)}</span>
                    </p>
                  ) : null}
                  {!ready ? (
                    <>
                      <ul className="mt-3 flex flex-col gap-1 text-base text-danger">
                        {diver.readiness.blockers.map((blocker) => (
                          <li key={blocker.code}>• {readinessBlockerText(t, blocker)}</li>
                        ))}
                      </ul>
                      {/* At departure this unblocks boarding; after a dive the
                          diver is aboard, so it's a shore follow-up on their record.

                          `?rf=blocked` as well as the anchor: the Guests roster
                          renders every diver on the boat as a ~200px card, so
                          landing on the anchor alone dropped a captain into the
                          middle of a long list with no sign of why they were
                          there or who else still needed the same errand. The
                          chip is the roster's own "blocked" filter, and this
                          link only renders for a diver whose readiness *is*
                          `blocked` (the one non-ready status there is), so the
                          filter it asks for can never hide the row it scrolls
                          to (2026-08-06 review). */}
                      <Link
                        href={`/shop/${shopSlug}/trips/${tripId}/guests?rf=blocked#booking-${diver.bookingId}`}
                        className="mt-2 inline-flex min-h-11 items-center text-base font-semibold text-primary hover:underline print:hidden"
                      >
                        {t("manifest.resolveBlockersLink")}
                      </Link>
                    </>
                  ) : null}
                  {/* What the desk already knows about this diver, where the
                      crew reading the roll call can see it. */}
                  <StaffNotes
                    notes={notesByBooking.get(diver.bookingId) ?? []}
                    locale={locale}
                    timezone={timezone}
                    t={t}
                  />
                  {/* The row's two secondary paths, on one line. Reference
                      facts are disclosed on demand — nine emergency contacts
                      and six rental lists at permanent height were dock-prep
                      and break-glass reference standing between the captain
                      and the next name (principles 9 and 10). One tap opens
                      them; paper always carries them (the print-only block
                      below — a closed details contributes nothing to print). */}
                  <div className={ROW_DISCLOSURE_GRID_CLASS}>
                    <details className="group/facts">
                      {/* Muted, not action-blue: two of these per row down a
                          nine-diver roster is eighteen links' worth of primary
                          ink for rare paths, drowning the one link that earns
                          it ("Resolve blockers"). The label names everything
                          behind it — a door marked "Contact & gear" with a
                          medical line behind it is a mislabeled door on a
                          safety surface (design review 20260810). */}
                      <summary className={ROW_DISCLOSURE_SUMMARY_CLASS}>
                        {/* The caret is what tells these lines apart from the
                            "Resolve blockers" navigation link beside them:
                            these disclose in place, that one leaves the page.
                            It is the app's drawn chevron rather than the `+`
                            that used to sit *after* the label — rotated 45° to
                            a ✕ on open, that glyph took the summary's own
                            `hover:underline` around with it, which is the
                            underline-at-an-angle a review caught under an open
                            "Contact & gear". Only the label underlines now. */}
                        <DisclosureCaret className="group-open/facts:rotate-90" />
                        <span className="group-hover/summary:underline">
                          {diver.medicalWaiver
                            ? t("manifest.diverFactsSummaryWithMedical")
                            : t("manifest.diverFactsSummary")}
                        </span>
                      </summary>
                      <div className={ROW_DISCLOSURE_PANEL_CLASS}>
                        <DiverFacts
                          diver={diver}
                          locale={locale}
                          timezone={timezone}
                          columns={1}
                          t={t}
                        />
                      </div>
                    </details>
                    {/* Closed, this is one quiet line — the same grammar as the
                        facts disclosure beside it. The private note is a desk
                        context write, not a boarding control, so it is available
                        before any roll-call result exists and stays collapsed
                        at rest. */}
                    <details className="group/note">
                      <summary className={ROW_DISCLOSURE_SUMMARY_CLASS}>
                        <DisclosureCaret className="group-open/note:rotate-90" />
                        <span className="group-hover/summary:underline">
                          {t("trips.roster.addFirstNoteSummary")}
                        </span>
                      </summary>
                      <div className={ROW_DISCLOSURE_PANEL_CLASS}>
                        <PrivateNoteForm
                          action={addPrivateNoteAction}
                          hiddenFields={{ bookingId: diver.bookingId }}
                          resetKey={
                            notesByBooking
                              .get(diver.bookingId)
                              ?.filter((note) => note.scope === "booking").length ?? 0
                          }
                          rows={2}
                          copy={{
                            label: t("trips.roster.addNoteLabel"),
                            placeholder: t("shared.rollCallNote.notePlaceholder"),
                            add: t("trips.roster.addPrivateNote"),
                            adding: t("trips.roster.adding"),
                          }}
                        />
                      </div>
                    </details>
                  </div>
                  <div className="mt-3 hidden print:block">
                    <DiverFacts
                      diver={diver}
                      locale={locale}
                      timezone={timezone}
                      columns={2}
                      t={t}
                    />
                  </div>
                  {rc && !rc.implied ? (
                    <p className="mt-3 text-sm text-muted">
                      {rc.note
                        ? t("manifest.rollCallRecordedByWithNote", {
                            label: rollCallLabelText(t, rollCallLabel(checkpoint, rc)),
                            date: formatDateTimeTz(rc.occurredAt, locale, timezone),
                            name: rc.recordedByName,
                            note: rc.note,
                          })
                        : t("manifest.rollCallRecordedByPlain", {
                            label: rollCallLabelText(t, rollCallLabel(checkpoint, rc)),
                            date: formatDateTimeTz(rc.occurredAt, locale, timezone),
                            name: rc.recordedByName,
                          })}
                    </p>
                  ) : impliedNotBoarded ? (
                    // The only thing that carries forward is a departure result:
                    // this diver never left the dock (DOM-H3). Boarding after a
                    // dive is a head count, so it never depends on readiness.
                    <p className="mt-3 text-sm text-muted">
                      {t("manifest.carriedForwardFromDock")}
                    </p>
                  ) : null}
                </div>
                <RollCallControls
                  kind="diver"
                  subjectId={diver.bookingId}
                  checkpoint={checkpoint}
                  isDeparture={isDeparture}
                  rollCall={rc}
                  action={rollCallAction}
                  copy={rollCallButtonCopy(diver.bookingId)}
                  showBoardControl={boardingControlShown}
                  noteDraftFor={{ bookingId: diver.bookingId, checkpoint }}
                  t={t}
                />
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
