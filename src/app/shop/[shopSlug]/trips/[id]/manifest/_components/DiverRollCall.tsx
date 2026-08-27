import Link from "next/link";
import type {
  RollCallAction,
  RollCallButtonCopy,
} from "@/app/shop/[shopSlug]/trips/[id]/_components/RollCallButton";
import { type PrivateNoteAction, PrivateNoteForm } from "@/components/PrivateNoteForm";
import { RollCallMark } from "@/components/RollCallMark";
import { Badge } from "@/components/ui/badge";
import { sectionCardClass } from "@/components/ui/card";
import { DisclosureCaret } from "@/components/ui/DisclosureCaret";
import { birthdayCalloutText } from "@/i18n/birthday-labels";
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
import { supportNeedsLines } from "@/i18n/support-needs-labels";
import { formatDateTimeTz, formatShortDate, formatTime } from "@/lib/format";
import { cachedListFormat } from "@/lib/intl-cache";
import {
  type ManifestBuddyTeam,
  type RollCallCheckpoint,
  rollCallLabel,
  type TripManifest,
} from "@/lib/manifests";
import { SHARED_FACT_MIN } from "../../_components/shared-facts";
import {
  ROLL_CALL_ROW_TONE,
  ROW_DISCLOSURE_PANEL_CLASS,
  ROW_DISCLOSURE_SUMMARY_CLASS,
  RollCallBackAboardControl,
  RollCallExceptionControl,
  RollCallMarkButton,
  rollCallMarkState,
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
 * screen-only person panel, and in a print-only block — a closed `<details>`
 * contributes nothing to print, and the printed manifest is the document a
 * coastguard reads, so it keeps every fact without asking paper to disclose.
 */
function DiverFacts({
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

/** The diver half of the head count — every active booking, one row each. */
export function DiverRollCall({
  divers,
  crewNames,
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
  /**
   * The crew rostered on this departure, by name. Read only to answer whether
   * the person a diver must dive with is on this boat (issue #1068) — a diver
   * may name the divemaster they always pair with, so a divers-only roster
   * would answer "not booked" about somebody standing next to them.
   */
  crewNames: readonly string[];
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
  // The same depth advisory resolving identically for much of the roster is
  // one fact about the plan, not nine facts about nine divers (principle 9) —
  // on the seeded wreck trip the identical 40-word paragraph rendered inside
  // nine of ten rows. Said once here, naming its divers; each of their rows
  // wears a two-word capsule instead. A diver whose advisory *differs* (a junior
  // cap, no card at all) keeps the full sentence in their panel, and **paper
  // keeps every row's full advisory** — the printed manifest goes ashore, and
  // a capsule pointing at a strip is a reference paper cannot follow.
  const advisoryDivers = new Map<string, string[]>();
  for (const diver of divers) {
    if (diver.depthAdvisory?.status !== "exceeds") continue;
    const text = depthWarningText(t, diver.depthAdvisory);
    advisoryDivers.set(text, [...(advisoryDivers.get(text) ?? []), diver.fullName]);
  }
  const sharedAdvisories = [...advisoryDivers.entries()].filter(
    ([, names]) => names.length >= SHARED_FACT_MIN,
  );
  const sharedAdvisoryTexts = new Set(sharedAdvisories.map(([text]) => text));
  // Which row the reader sees first, which is not `divers[0]` once an alarm
  // pulls one up. Derived from the same `rollCallRowState` the rows use, so the
  // hairline above the top row cannot disagree with what `order-first` moved.
  // Every name on this departure, divers and crew — what a diver's "dives with"
  // line is checked against (issue #1068). Derived once here rather than per
  // row: it is a property of the departure, not of any diver on it.
  const rosterNames = [...divers.map((diver) => diver.fullName), ...crewNames];
  const firstOnScreenBookingId =
    divers.find((diver) => rollCallRowState(checkpoint, diver.rollCall).notBackAboard)?.bookingId ??
    divers[0]?.bookingId;
  return (
    <section id="roll-call-list" tabIndex={-1} className="mt-8 outline-none">
      {/* No "Shop time: Eastern Daylight Time" beside the heading. Every time
          on this page is already the shop's own — that is the app's rule
          everywhere (`shops.timezone`, `pnpm check:timezone`), not a property
          of this screen — and a crew reading a roll call at their own dock has
          no second zone to confuse it with.
          No standing caption under it either. "After a dive, 'not back aboard'
          means this diver has not returned to the boat" was a permanent warning
          sentence explaining a control that is no longer on the row — and a
          standing warning at a checkpoint where nothing has been recorded is
          exactly what decision 4 exists to stop. The control names itself,
          inside the panel where it lives. */}
      <h2 className="text-lg font-semibold">
        {t("manifest.checkpointRollCallHeading", {
          checkpoint: rollCallCheckpointText(t, checkpoint),
        })}
      </h2>
      {sharedAdvisories.length > 0 ? (
        <div className="mt-3 flex flex-col gap-2 print:hidden">
          {sharedAdvisories.map(([text, names]) => (
            <div
              key={text}
              className="flex gap-2 rounded-lg bg-warning-tint px-3 py-2 text-base text-warning-strong"
            >
              <span aria-hidden="true">▲</span>
              <div>
                <p>{text}</p>
                <p className="font-semibold">
                  {t("manifest.sharedDepthApplies", {
                    names: cachedListFormat(locale, {
                      style: "long",
                      type: "conjunction",
                    }).format(names),
                  })}
                </p>
              </div>
            </div>
          ))}
        </div>
      ) : null}
      {/* **A flex column, and no `divide-y`** (decision 4, issue #1054).
          A diver recorded not back aboard is pulled to the top *on screen* with
          `order-first`, because that row is where a crew member taps to record
          her back and it is otherwise three or four screens below the alarm.
          `print:order-none` puts her back: the printed sheet goes ashore and
          into a coastguard's hands, and it stays in strict manifest order.

          `divide-y` cannot survive that. It draws its hairlines by DOM order,
          so the visually-first row would carry a stray top rule and the
          visually-last would lack one. Each row draws its own instead, off the
          two orders it actually has — and on an inner wrapper rather than the
          `<li>`, whose tone classes set `border-danger`/`border-success` for
          the 4px left edge and would win the top edge's colour too. */}
      <ul
        className={sectionCardClass({
          padding: "none",
          className: "mt-3 flex flex-col overflow-hidden",
        })}
      >
        {divers.map((diver, index) => {
          const diverStatus = diver.readiness.status;
          const ready = diverStatus === "ready";
          const rc = diver.rollCall;
          // One derivation of what a roll-call record means, shared with the
          // crew list and the mark (`rollCallRowState`).
          const rowState = rollCallRowState(checkpoint, rc);
          const { impliedNotBoarded } = rowState;
          // Each roll-call state gets its own fill (`ROLL_CALL_ROW_TONE`) so
          // staff can tell at a glance who has been handled — aboard green,
          // left ashore amber, not back aboard red, nothing said yet slate.
          //
          // Untouched rows are where the diver list differs from the crew's: at
          // the dock a blocked diver's readiness *is* the thing to fix before
          // they board, so the row says so. After a dive it is not — roll call
          // there is a physical head count that readiness never gates, and a
          // danger-tinted row for a paperwork state would compete with the one
          // red on the page that means somebody is in the water (DD9), which is
          // also decision 4's rule: an alarm is earned by a recorded fact.
          const recordedTone = rollCallRecordedTone(rowState);
          const blockedAtDock = !ready && isDeparture;
          const untouchedTone = blockedAtDock
            ? ROLL_CALL_ROW_TONE.blocked
            : ROLL_CALL_ROW_TONE.awaiting;
          // Every row is a jump target — the count panel's chips link to any
          // uncalled person — so every row carries the scroll margin that keeps
          // its name clear of the sticky panel. Shared with the crew rows.
          // Only a *recorded* not-back moves. Aboard, ashore and to-call rows
          // stay where the manifest put them, because only this one is an
          // alarm — and a row that shifts under a thumb mid-count is the
          // mis-tap `rollCallScrollMargin` exists to bound, so it is spent
          // once, on the one state that earns it.
          const alarmed = rowState.notBackAboard;
          const rowClass = `border-l-4 ${alarmed ? "order-first print:order-none" : ""} ${rollCallScrollMargin(isDeparture)} ${
            recordedTone ? ROLL_CALL_ROW_TONE[recordedTone] : untouchedTone
          }`;
          // The hairline above this row, in each of the two orders. On screen
          // the first row is the first alarmed one when there is any; on paper
          // it is always the top of the manifest.
          const ruleClass = `${
            diver.bookingId === firstOnScreenBookingId ? "border-t-0" : "border-t"
          } border-border ${index === 0 ? "print:border-t-0" : "print:border-t"}`;
          // A diver only boards at the dock once readiness clears them. Their
          // row then carries a *static* held ring rather than a tap: the act
          // that unblocks them is ashore on the Trip tab, and offering a tap
          // that the server would refuse is a control that lies.
          const boardingControlShown = ready || !isDeparture;
          // **At most one capsule, and only for an exception** (ADR
          // 20260827-the-departure-is-two-working-surfaces, decision 1). A row
          // at rest is a name and a mark; the expected state is quiet. This is
          // the priority when a diver is several things at once, loudest first
          // — a split buddy team outranks a desk blocker outranks the crew's
          // duty of care to a minor outranks an advisory outranks a birthday.
          // Everything not chosen here still reaches the reader: it is in the
          // panel one tap away, and unconditionally on paper.
          // Which of the five the capsule ended up being, so the printed block
          // below can say the *other* four without repeating this one. Paper
          // carries every fact the screen tucks away; it does not carry the
          // same fact twice.
          const capsuleKind = diver.buddyAlert
            ? "buddy"
            : blockedAtDock
              ? "blocked"
              : diver.minor && diver.age !== null && diver.age !== undefined
                ? "minor"
                : diver.depthAdvisory?.status === "exceeds"
                  ? "depth"
                  : diver.birthday
                    ? "birthday"
                    : null;
          const capsule =
            diver.buddyAlert && diver.buddyTeam ? (
              <Badge tone={diver.buddyAlert === "separated_after_dive" ? "danger" : "warning"}>
                {buddyAlertText(t, diver.buddyAlert)}
              </Badge>
            ) : blockedAtDock ? (
              <Badge tone={readinessStatusTone(diverStatus)}>
                {readinessStatusText(t, diverStatus)}
              </Badge>
            ) : diver.minor && diver.age !== null && diver.age !== undefined ? (
              <Badge tone="warning" tabularNums>
                {t("manifest.minorAge", { age: diver.age })}
              </Badge>
            ) : diver.depthAdvisory?.status === "exceeds" ? (
              <Badge tone="warning">{t("manifest.depthChip")}</Badge>
            ) : diver.birthday ? (
              <Badge tone="primary">{birthdayCalloutText(t, diver.birthday)}</Badge>
            ) : null;
          // The one line under the name: **who said what, and when.** Roll call
          // is never optimistic and every result keeps its who-and-when, so the
          // moment a row is anything but "to call" it says so in words — which
          // is also what keeps every colour-carried state carrying a word
          // (decision 5). Nothing said yet renders nothing: an untouched row is
          // a name and an empty ring, and that is the whole message.
          //
          // **Time, not a timestamp.** "Boarded Aug 27, 2:52 PM EDT by Sal
          // Moretti" wrapped to three lines under every settled name, which put
          // 60px of date between one diver and the next on a phone — and every
          // roll call for a departure happens on that departure's own day, so
          // the date was the one part nobody could be in doubt about. The full
          // timestamp is not lost: it prints, below, on the sheet that goes
          // ashore and may be read months later.
          const auditLabel = rollCallLabelText(t, rollCallLabel(checkpoint, rc));
          const supportLine =
            rc && !rc.implied
              ? t("manifest.rollCallRecordedShort", {
                  label: auditLabel,
                  time: formatTime(rc.occurredAt, locale, timezone),
                  name: rc.recordedByName,
                })
              : impliedNotBoarded
                ? // The only thing that carries forward is a departure result:
                  // this diver never left the dock (DOM-H3). Boarding after a
                  // dive is a head count, so it never depends on readiness.
                  t("manifest.carriedForwardFromDock")
                : null;
          const bookingNotes = notesByBooking.get(diver.bookingId) ?? [];
          const teamLabel = buddyTeamLabel(diver.buddyTeam ? [diver.buddyTeam] : []);
          return (
            <li key={diver.bookingId} id={`diver-row-${diver.bookingId}`} className={rowClass}>
              <div className={ruleClass}>
                <div className="flex items-start">
                  {/* The name column *is* the disclosure. One tap on the person
                    opens everything the rail does not need this second — the
                    "one tap away" tier of decision 2 — which is what lets the
                    row at rest be a name and a mark instead of the name, two
                    badges, a blocker list, a link, a note thread and two
                    summary lines it used to be. */}
                  <details className="group/person min-w-0 flex-1">
                    <summary className={ROW_DISCLOSURE_SUMMARY_CLASS}>
                      <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-surface text-sm font-bold tabular-nums">
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="text-lg font-semibold group-hover/summary:underline">
                            {diver.fullName}
                          </span>
                          {capsule}
                        </span>
                        {supportLine ? (
                          <span className="mt-0.5 block text-sm text-muted">{supportLine}</span>
                        ) : null}
                      </span>
                      {/* The caret is the only thing on the summary that says
                        "this opens" — the label is the person's own name, which
                        cannot also be a verb. Screen readers get the word. */}
                      <DisclosureCaret className="group-open/person:rotate-90 print:hidden" />
                      <span className="sr-only">{t("manifest.personDetails")}</span>
                    </summary>
                    <div className={ROW_DISCLOSURE_PANEL_CLASS}>
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
                          {/* `?rf=blocked` as well as the anchor: the Guests
                            roster renders every diver on the boat, so landing
                            on the anchor alone dropped a captain into the
                            middle of a long list with no sign of why they were
                            there or who else still needed the same errand. This
                            link only renders for a diver whose readiness *is*
                            blocked, so the filter it asks for can never hide
                            the row it scrolls to. */}
                          <Link
                            href={`/shop/${shopSlug}/trips/${tripId}/guests?rf=blocked#booking-${diver.bookingId}`}
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
                        {teamLabel ? (
                          <li>
                            {/* The team, and — when the row's capsule is
                              shouting about it — *who* is unaccounted for.
                              The capsule can only carry the alert; this is
                              where a crew member finds the name behind it. */}
                            <Badge tone={diver.buddyAlert ? "danger" : "neutral"}>
                              {diver.buddyAlert
                                ? `${teamLabel} · ${buddyAlertText(t, diver.buddyAlert)}`
                                : teamLabel}
                            </Badge>
                          </li>
                        ) : null}
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
                        {diver.age !== null &&
                        diver.age !== undefined &&
                        capsuleKind !== "minor" ? (
                          <li>
                            <Badge tone={diver.minor ? "warning" : "neutral"} tabularNums>
                              {diver.minor
                                ? t("manifest.minorAge", { age: diver.age })
                                : t("manifest.age", { age: diver.age })}
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
                      {rowState.notBackAboard ? (
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
                        copy={rollCallButtonCopy(diver.bookingId)}
                        t={t}
                      />
                    </div>
                  </details>
                  {/* The row's one tap, at the trailing edge where every row's
                    mark lands. `pt-2.5` centres the 56px circle against the
                    76px summary line rather than against the panel below it,
                    which would walk the mark down the row as it opens. */}
                  <div className="shrink-0 pt-2.5 ps-3 pe-3 print:hidden">
                    {rowState.notBackAboard ? (
                      <RollCallMark state="notBack" />
                    ) : boardingControlShown ? (
                      <RollCallMarkButton
                        kind="diver"
                        subjectId={diver.bookingId}
                        checkpoint={checkpoint}
                        rollCall={rc}
                        action={rollCallAction}
                        copy={rollCallButtonCopy(diver.bookingId)}
                        markState={rollCallMarkState(rowState)}
                        t={t}
                      />
                    ) : (
                      <RollCallMark state="held" />
                    )}
                  </div>
                </div>
                {/* **Paper keeps everything the screen tucks away** (decision 2).
                  A closed `<details>` contributes nothing to print, so every
                  fact behind the tap above is restated here unconditionally:
                  the recorded state as a word, the exceptions the one capsule
                  could not carry, the blockers at any checkpoint, the full
                  depth advisory, and the contact block. The summary line above
                  prints as it stands, so the name, the capsule and the
                  who-and-when are already on the sheet and are not repeated. */}
                <div className="hidden px-4 pb-4 print:block">
                  <p className="flex flex-wrap items-center gap-2">
                    <span
                      className={
                        impliedNotBoarded
                          ? "rounded-full bg-warning-tint px-3 py-1 text-sm font-medium text-warning-strong"
                          : "rounded-full bg-surface px-3 py-1 text-sm font-medium text-muted"
                      }
                    >
                      {rollCallLabelText(t, rollCallLabel(checkpoint, rc))}
                    </span>
                    {ready || capsuleKind === "blocked" ? null : (
                      <Badge tone={readinessStatusTone(diverStatus)}>
                        {readinessStatusText(t, diverStatus)}
                      </Badge>
                    )}
                    {diver.checkedIn ? (
                      <Badge tone="neutral">{t("manifest.checkedInPill")}</Badge>
                    ) : null}
                    {diver.hotelPickupLocation ? (
                      <Badge tone="neutral">
                        {diver.hotelPickupLocation}
                        {diver.pickupTime ? ` · ${diver.pickupTime}` : ""}
                      </Badge>
                    ) : null}
                    {diver.age !== null && diver.age !== undefined && capsuleKind !== "minor" ? (
                      <Badge tone={diver.minor ? "warning" : "neutral"} tabularNums>
                        {diver.minor
                          ? t("manifest.minorAge", { age: diver.age })
                          : t("manifest.age", { age: diver.age })}
                      </Badge>
                    ) : null}
                    {diver.birthday && capsuleKind !== "birthday" ? (
                      <Badge tone="primary">{birthdayCalloutText(t, diver.birthday)}</Badge>
                    ) : null}
                    {teamLabel ? (
                      <Badge tone="neutral">
                        {teamLabel}
                        {diver.buddyAlert ? ` · ${buddyAlertText(t, diver.buddyAlert)}` : ""}
                      </Badge>
                    ) : null}
                  </p>
                  {ready ? null : (
                    <ul className="mt-2 flex flex-col gap-1 text-base">
                      {diver.readiness.blockers.map((blocker) => {
                        const text = readinessBlockerText(t, blocker);
                        return <li key={text}>• {text}</li>;
                      })}
                    </ul>
                  )}
                  {diver.depthAdvisory?.status === "exceeds" ? (
                    <p className="mt-2 text-base">▲ {depthWarningText(t, diver.depthAdvisory)}</p>
                  ) : null}
                  {/* The audit line **in full** — the screen's compact
                    "Boarded · 7:12 AM · Sal Moretti" is a same-day reading on
                    the boat; the sheet that goes ashore may be read months
                    later, so it carries the date and the zone. */}
                  {rc && !rc.implied ? (
                    <p className="mt-2 text-sm">
                      {t("manifest.rollCallRecordedByPlain", {
                        label: auditLabel,
                        date: formatDateTimeTz(rc.occurredAt, locale, timezone),
                        name: rc.recordedByName,
                      })}
                    </p>
                  ) : null}
                  <div className="mt-2">
                    <DiverFacts
                      diver={diver}
                      locale={locale}
                      timezone={timezone}
                      columns={2}
                      rosterNames={rosterNames}
                      t={t}
                    />
                  </div>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
