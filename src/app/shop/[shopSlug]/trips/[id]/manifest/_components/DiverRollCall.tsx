import Link from "next/link";
import type {
  RollCallAction,
  RollCallButtonCopy,
} from "@/app/shop/[shopSlug]/trips/[id]/_components/RollCallButton";
import { RollCallNote } from "@/components/RollCallNote";
import { Badge } from "@/components/ui/badge";
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
import { formatDateTimeTz, formatShortDate, formatTimeZoneName } from "@/lib/format";
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
  t,
}: {
  diver: TripManifest["divers"][number];
  locale: string;
  timezone: string;
  t: StaffTranslator;
}) {
  return (
    <div className="grid gap-2 text-base sm:grid-cols-2">
      <p>
        <span className="font-bold">{t("trips.manifest.emergencyContactLabel")}</span>
        <span className="mt-0.5 block text-muted">
          {diver.emergencyContactName && diver.emergencyContactPhone
            ? `${diver.emergencyContactName} · ${diver.emergencyContactPhone}`
            : t("trips.manifest.notOnFile")}
        </span>
      </p>
      {/* Only when there is something to load or a note to read:
          "No fit on file — not asked yet" printed on most rows
          is the absence of information formatted as information
          (principle 9), and Prep owns chasing the gap. A nitrox
          request always shows — that's an operational fact. */}
      {diver.rentalFit.state !== "not_recorded" || diver.nitroxRequested ? (
        <p>
          <span className="font-bold">{t("trips.manifest.rentalFitLabel")}</span>
          <span className="mt-0.5 block text-muted">
            {rentalFitLineText(t, locale, diver.rentalFit)}
            {diver.nitroxRequested ? t("trips.manifest.nitroxRequestedSuffix") : ""}
          </span>
        </p>
      ) : null}
      {diver.medicalWaiver ? (
        <p>
          <span className="font-bold">
            {diver.medicalWaiver.source === "paper"
              ? t("trips.manifest.medicalReviewedPaper")
              : diver.medicalWaiver.source === "imported"
                ? t("trips.manifest.medicalClearanceImported")
                : t("trips.manifest.medicalWaiverSigned")}
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
 * note" — as one pair of class strings.
 *
 * They stack one directly above the other, and they used to be written twice:
 * identical while shut, and nothing alike once open, because only the note grew
 * a bordered panel. Two controls that read as one kind at rest and two kinds
 * open is a hesitation the rail cannot afford, so the panel treatment belongs
 * to both — and lives here once rather than in two class strings that already
 * drifted apart.
 */
const ROW_DISCLOSURE_CLASS =
  "mt-1 max-w-xl print:hidden open:mt-3 open:rounded-xl open:border open:border-border/70 open:bg-surface-sunken/50 open:p-3";
const ROW_DISCLOSURE_SUMMARY_CLASS =
  "flex min-h-11 cursor-pointer items-center gap-1 text-base font-medium text-muted hover:text-primary hover:underline";

/** The diver half of the head count — every active booking, one row each. */
export function DiverRollCall({
  divers,
  checkpoint,
  isDeparture,
  shopSlug,
  tripId,
  locale,
  timezone,
  rollCallAction,
  saveRollCallNoteAction,
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
  rollCallAction: RollCallAction;
  saveRollCallNoteAction: (
    bookingId: string,
    checkpoint: string,
    note: string,
  ) => Promise<{ ok: boolean; saved: boolean }>;
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
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">
            {t("trips.manifest.checkpointRollCallHeading", {
              checkpoint: rollCallCheckpointText(t, checkpoint),
            })}
          </h2>
          {/* The control that isn't "Boarded" means something different once
              the boat is out, and the crew tapping it in the dark should be
              told which one they are looking at (DOM-H3). */}
          {isDeparture ? null : (
            <p className="mt-1 max-w-prose text-base font-semibold text-warning-strong">
              {t("trips.manifest.notBackAboardDescription")}
            </p>
          )}
        </div>
        {/* The zone by the name a captain says, never the IANA id it is stored
            under (`formatTimeZoneName`) — "Shop time: America/New_York" was
            the page showing its own storage format. */}
        <p className="text-sm text-muted">
          {t("trips.manifest.shopTimeLabel", {
            timezone: formatTimeZoneName(locale, timezone),
          })}
        </p>
      </div>
      <ul className="mt-4 divide-y divide-border rounded-lg border border-border bg-surface">
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
          // Every row is a jump target now — the summary panel's chips link to
          // any uncalled diver — so every row carries the scroll margin that
          // keeps its name clear of the sticky checkpoint panel. Sized to the
          // panel at its tallest for the checkpoint kind: after a dive it can
          // carry up to three pinned danger lines, and a jump that buries the
          // name under the panel invites a tap on the *next* visible row's
          // button for the wrong diver (dive-domain review 20260810).
          const scrollMargin = isDeparture ? "scroll-mt-64 " : "scroll-mt-80 ";
          const rowClass = `border-l-4 px-4 py-5 sm:px-5 ${scrollMargin}${
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
                <div className="min-w-0">
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
                      <Badge tone="neutral">{t("trips.manifest.checkedInPill")}</Badge>
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
                          {t("trips.manifest.minorAge", { age: diver.age })}
                        </Badge>
                      ) : (
                        <span className="hidden print:inline-flex">
                          <Badge tone="neutral" tabularNums>
                            {t("trips.manifest.age", { age: diver.age })}
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
                        {t("trips.manifest.resolveBlockersLink")}
                      </Link>
                    </>
                  ) : null}
                  {/* Reference facts, disclosed on demand. The row's job at
                      the rail is the head count — nine emergency contacts and
                      six rental lists at permanent height were dock-prep and
                      break-glass reference standing between the captain and
                      the next name (principles 9 and 10). One tap opens them;
                      paper always carries them (the print-only block below —
                      a closed details contributes nothing to print). */}
                  <details className={`group/facts ${ROW_DISCLOSURE_CLASS}`}>
                    {/* Muted, not action-blue: two of these per row down a
                        nine-diver roster is eighteen links' worth of primary
                        ink for rare paths, drowning the one link that earns
                        it ("Resolve blockers"). The label names everything
                        behind it — a door marked "Contact & gear" with a
                        medical line behind it is a mislabeled door on a
                        safety surface (design review 20260810). */}
                    <summary className={ROW_DISCLOSURE_SUMMARY_CLASS}>
                      {diver.medicalWaiver
                        ? t("trips.manifest.diverFactsSummaryWithMedical")
                        : t("trips.manifest.diverFactsSummary")}
                      <span
                        aria-hidden="true"
                        className="font-normal transition-transform duration-200 group-open/facts:rotate-45"
                      >
                        +
                      </span>
                    </summary>
                    {/* Same `mt-2` the note panel's own root carries, so the
                        two open panels sit the same distance below their
                        summary line. */}
                    <div className="mt-2">
                      <DiverFacts diver={diver} locale={locale} timezone={timezone} t={t} />
                    </div>
                  </details>
                  <div className="mt-3 hidden print:block">
                    <DiverFacts diver={diver} locale={locale} timezone={timezone} t={t} />
                  </div>
                  {/* Closed, this is one quiet line — the same grammar as the
                      "Resolve blockers" link above it. The box only exists
                      around an open note: rendered shut on every diver, the
                      bordered sunken card read as an empty *input* repeated
                      the length of the boat, which is nine boxes of chrome
                      for an action most roll calls never take (design
                      principles 8 and 10 — collapse the rare path; hierarchy
                      before boxes). */}
                  <details className={`group/note ${ROW_DISCLOSURE_CLASS}`}>
                    {/* The plus glyph is what tells this line apart from the
                        "Resolve blockers" navigation link it can stack under:
                        this one discloses in place (rotating to a ✕ when
                        open), that one leaves the page. `flex` suppresses the
                        native marker, so without it the two would be
                        indistinguishable. Same idiom as the divers page's
                        add-diver summary. */}
                    <summary className={ROW_DISCLOSURE_SUMMARY_CLASS}>
                      {t("trips.manifest.addNoteSummary")}
                      <span
                        aria-hidden="true"
                        className="font-normal transition-transform duration-200 group-open/note:rotate-45"
                      >
                        +
                      </span>
                    </summary>
                    <RollCallNote
                      bookingId={diver.bookingId}
                      checkpoint={checkpoint}
                      formId={`not-boarded-${diver.bookingId}`}
                      initialNote={rc && !rc.implied ? (rc.note ?? "") : ""}
                      canAutoSave={!!rc && !rc.implied}
                      saveNote={saveRollCallNoteAction}
                      copy={{
                        optionalNote: t("shared.rollCallNote.optionalNote"),
                        message: {
                          manualOnly: t("shared.rollCallNote.message.manualOnly"),
                          saving: t("shared.rollCallNote.message.saving"),
                          saved: t("shared.rollCallNote.message.saved"),
                          queued: t("shared.rollCallNote.message.queued"),
                          error: t("shared.rollCallNote.message.error"),
                          idle: t("shared.rollCallNote.message.idle"),
                        },
                        statusPill: {
                          saving: t("shared.rollCallNote.statusPill.saving"),
                          saved: t("shared.rollCallNote.statusPill.saved"),
                          queued: t("shared.rollCallNote.statusPill.queued"),
                          error: t("shared.rollCallNote.statusPill.error"),
                        },
                        notePlaceholder: t("shared.rollCallNote.notePlaceholder"),
                      }}
                    />
                  </details>
                  {rc && !rc.implied ? (
                    <p className="mt-3 text-sm text-muted">
                      {rc.note
                        ? t("trips.manifest.rollCallRecordedByWithNote", {
                            label: rollCallLabelText(t, rollCallLabel(checkpoint, rc)),
                            date: formatDateTimeTz(rc.occurredAt, locale, timezone),
                            name: rc.recordedByName,
                            note: rc.note,
                          })
                        : t("trips.manifest.rollCallRecordedByPlain", {
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
                      {t("trips.manifest.carriedForwardFromDock")}
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
                  formId={`not-boarded-${diver.bookingId}`}
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
