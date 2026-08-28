"use client";

import Link from "next/link";
import { unstable_rethrow } from "next/navigation";
import { useEffect, useState } from "react";
import { BoardingSeats } from "@/components/BoardingBar";
import { EarnedMomentLine } from "@/components/EarnedMoment";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { SectionCard } from "@/components/ui/card";
import { DisclosureCaret } from "@/components/ui/DisclosureCaret";
import { controlClass, Field, FormStatus } from "@/components/ui/form";
import type { DepartureSummary } from "@/db/today";
import { fill, pluralForm } from "@/i18n/fill";
import { formatTimeRange } from "@/lib/format";
import type { AboardBlockerKind } from "@/lib/readiness";

export type DepartureBoardCopy = {
  crewingBadge: string;
  courseSession: string;
  boarding: string;
  openGuests: string;
  assignCrewMemberAria: string;
  assignCrewOption: string;
  assignCrewLabel: string;
  assignFailed: string;
  unassignAria: string;
  noCrewAssigned: string;
  crewLine: string;
  editCrew: string;
  boardingSummary: string;
  boardingAboardOne: string;
  boardingAboardOther: string;
  boardingReadyOne: string;
  boardingReadyOther: string;
  boardingBlockedOne: string;
  boardingBlockedOther: string;
  boardingOpenOne: string;
  boardingOpenOther: string;
  blockedWarningNamed: string;
  blockedWarningOne: string;
  blockedWarningOther: string;
  blockedAboardNamed: string;
  blockedAboardOne: string;
  blockedAboardOther: string;
  aboardReasonMedical: string;
  aboardReasonUnknown: string;
  aboardReasonCertification: string;
  aboardReasonPayment: string;
  noneBooked: string;
  everyoneAboard: string;
  crewRollCallOpen: string;
  clearToBoard: string;
  sailingToday: string;
};

/** What one aboard group is blocked on, in words. */
function aboardReasonText(copy: DepartureBoardCopy, kind: AboardBlockerKind): string {
  if (kind === "medical") return copy.aboardReasonMedical;
  if (kind === "unknown") return copy.aboardReasonUnknown;
  if (kind === "certification") return copy.aboardReasonCertification;
  return copy.aboardReasonPayment;
}

/** One count of the boarding summary, inflected for its own number. */
function boardingFragment(count: number, one: string, other: string, locale: string): string {
  return fill(pluralForm(count, { one, other }, locale), { count });
}

function DepartureCard({
  departure,
  shopSlug,
  timeZone,
  locale,
  crewed = false,
  availableStaff,
  updateCrewAction,
  copy,
}: {
  departure: DepartureSummary;
  shopSlug: string;
  timeZone: string;
  locale: string;
  crewed?: boolean;
  availableStaff: { id: string; fullName: string; roles: string[] }[];
  updateCrewAction: (
    tripId: string,
    change: { personId: string; operation: "assign" | "unassign" },
  ) => Promise<{ ok: boolean }>;
  copy: DepartureBoardCopy;
}) {
  const {
    blocked,
    blockedAshoreNames,
    blockedAboard,
    blockedAboardGroups,
    blockedAshore,
    ready,
    boarded,
    booked,
    capacity,
    crewAccountedFor,
    crewReason,
  } = departure;
  const [localCrew, setLocalCrew] = useState(departure.crew || []);
  const [assignError, setAssignError] = useState(false);
  const [justAddedId, setJustAddedId] = useState<string | null>(null);

  useEffect(() => {
    setLocalCrew(departure.crew || []);
  }, [departure.crew]);

  // Confirm-then-render, not optimistic-then-rollback — same reasoning as
  // CrewSection.tsx's handleAssign/handleUnassign (this editor drives the
  // identical `updateCrewAction`/`course_unstaffed` server gate a staffer
  // can immediately hit by tapping "Open guests" on this same card). An
  // optimistic update here would show a departure as crewed before the
  // write actually committed.
  const handleAssign = async (staffId: string) => {
    const staff = availableStaff.find((s) => s.id === staffId);
    if (!staff) return;
    if (localCrew.some((c) => c.id === staffId)) return;

    setAssignError(false);

    try {
      const res = await updateCrewAction(departure.tripId, {
        personId: staffId,
        operation: "assign",
      });
      if (res.ok) {
        setLocalCrew([...localCrew, staff]);
        setJustAddedId(staffId);
      } else {
        setAssignError(true);
      }
    } catch (error) {
      // **The refusal is not a failure.** `updateTripCrewAction` opens with
      // `requireShopSurface`, whose contract is that *every* refusal throws — a
      // cross-shop slug is `notFound()`, a failed permission gate is
      // `redirect()` — and those sentinels reach this catch on the client too.
      // Swallowing one turned a refusal into "That didn't save", so the
      // navigation happened *and* the row claimed a transport error. Measured
      // on the check-in queue's twin of this catch (issue #819); this is the
      // same shape `scripts/check-redirect-in-try.mjs` refuses on the server.
      unstable_rethrow(error);
      setAssignError(true);
    }
  };

  const handleUnassign = async (staffId: string) => {
    setAssignError(false);

    try {
      const res = await updateCrewAction(departure.tripId, {
        personId: staffId,
        operation: "unassign",
      });
      if (res.ok) {
        setLocalCrew(localCrew.filter((c) => c.id !== staffId));
      } else {
        setAssignError(true);
      }
    } catch (error) {
      // The refusal is not a failure — see the catch above.
      unstable_rethrow(error);
      setAssignError(true);
    }
  };

  const crewNames = localCrew.map((c) => c.fullName).join(", ");

  return (
    <SectionCard as="li" padding="md" className="list-none">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          {/* **The whole window, said once.** This was the start time in
              headline figures with the full range repeated in a muted line
              underneath — the same departure time twice, three lines apart,
              plus a seat count the boarding summary below already breaks into
              aboard/ready/blocked/open. The range carries the end time up
              here and the line under it is gone (principle 9). */}
          <p className="flex flex-wrap items-center gap-2 text-2xl font-semibold tracking-tight tabular-nums">
            {formatTimeRange(departure.startsAt, departure.endsAt, locale, timeZone)}
            {crewed ? <Badge tone="primary">{copy.crewingBadge}</Badge> : null}
          </p>
          <h3 className="mt-0.5 font-semibold">{departure.title}</h3>
          {/* A fact, not a link — the action color would promise a tap. */}
          {departure.courseTitle ? (
            <p className="text-sm font-medium text-muted">
              {fill(copy.courseSession, { title: departure.courseTitle })}
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {/* The manifest opens on "Before departure" — the boarding pass — so
              one tap boards the boat; Guests is where the roster is managed. */}
          <Link
            href={`/shop/${shopSlug}/trips/${departure.tripId}/manifest`}
            className={buttonClass()}
          >
            {copy.boarding}
          </Link>
          <Link
            href={`/shop/${shopSlug}/trips/${departure.tripId}/guests`}
            className={buttonClass({ variant: "secondary" })}
          >
            {copy.openGuests}
          </Link>
        </div>
      </div>

      {/* One strip, one caption, one quiet count line — the whole readiness
          read for this boat, drawn seat by seat exactly as the trip Overview
          draws it. The strip stays decorative because the counts are plain
          text right under it (principle 6: exact numbers, and state is never
          carried by hue alone). */}
      <div className="mt-4">
        <BoardingSeats boarded={boarded} ready={ready} blocked={blocked} capacity={capacity} />
        {booked > 0 ? (
          <p className="mt-2 text-sm text-muted tabular-nums">
            {/* **Four counts, four plurals, one sentence.** This line used to
                be one template with four hard-coded plural nouns, so a boat
                with a single diver aboard rendered "1 listos para embarcar · 1
                bloqueados · 1 plazas libres" — three errors at once, because
                Spanish inflects the adjective as well as the noun, and "1 seats
                open" in English (issue #778).

                A pair per count resolved through `pluralForm`, the same shape
                `blockedWarningOne`/`Other` two blocks below already uses:
                `fill` is a plain `{key}` replacer with no ICU parser, and this
                copy crosses to a Client Component as a raw template, so a
                single ICU message is not available at this call site. The
                template that survives holds only the separator and the order,
                which are the locale's to own and not this file's. */}
            {fill(copy.boardingSummary, {
              aboard: boardingFragment(
                boarded,
                copy.boardingAboardOne,
                copy.boardingAboardOther,
                locale,
              ),
              ready: boardingFragment(
                ready,
                copy.boardingReadyOne,
                copy.boardingReadyOther,
                locale,
              ),
              blocked: boardingFragment(
                blocked,
                copy.boardingBlockedOne,
                copy.boardingBlockedOther,
                locale,
              ),
              open: boardingFragment(
                Math.max(0, capacity - booked),
                copy.boardingOpenOne,
                copy.boardingOpenOther,
                locale,
              ),
            })}
          </p>
        ) : null}
        {blockedAboard > 0 || blockedAshore > 0 ? (
          // The most operational sentence on the page — read in glare at the
          // dock deciding whether the boat leaves — so it holds 16px. One
          // blocked diver is named outright: the answer, not a door to it.
          // Regular weight and ink on purpose: the bar's red segment and the
          // counts line already state the blocked fact, and a third statement
          // in bold red made the card sound an alarm three times for one fact
          // (principle 9). The words carry the state; the name is the value.
          //
          // **A card may go quiet about a blocker; it may never affirm the
          // opposite.** The all-clear line below is gated on `blocked === 0`,
          // not on the split counts: when every blocked diver on a boat is
          // marked `not_boarded`, both split counts are zero and the chain used
          // to fall through to "Everyone booked on this trip is clear to board"
          // — three pixels under a counts line reading "1 blocked". That is the
          // same self-contradicting card #698 existed to remove, pointing the
          // other way (found by `dive-domain-expert` after it shipped).
          //
          // **Two facts, not one.** A blocked diver already on the boat and a
          // blocked diver still ashore are different situations, and the card
          // used to describe both — plus divers the crew had marked as never
          // leaving the dock — as "cannot board yet". On a boat with eight
          // aboard that reads as "there is still time" about a gate that is
          // already behind three of them (issue #698). Aboard leads, because it
          // is the more serious of the two; where both are true both lines
          // render, since neither number covers the other's people.
          <>
            {/* **One line per kind, worst first — never one reason over a
                whole count.** The first cut returned a single kind for the
                aboard group and rendered it against the group's total: one
                medical hold beside four certification gaps read "5 divers are
                aboard — a medical hold", which is false about four of the
                five. Run it the other way and the four vanish, so a crew
                clears the one diver it was told about and sails with four who
                have made no medical declaration. Almost always this is one
                line; at worst four, and four true lines beat one false one on
                a boat (`dive-domain-expert`, on issue #791).

                Each group carries its own names, so the naming condition asks
                about that group alone — `blocked === 1` meant a boat with one
                diver blocked aboard and one ashore named neither of them. */}
            {blockedAboardGroups.map((group) => (
              <p key={group.kind} className="mt-1.5 text-base">
                {fill(
                  group.names.length === 1 && group.names[0]
                    ? copy.blockedAboardNamed
                    : pluralForm(
                        group.names.length,
                        { one: copy.blockedAboardOne, other: copy.blockedAboardOther },
                        locale,
                      ),
                  {
                    name: group.names[0],
                    count: group.names.length,
                    reason: aboardReasonText(copy, group.kind),
                  },
                )}
              </p>
            ))}
            {blockedAshore > 0 ? (
              <p className="mt-1.5 text-base">
                {/* Unchanged in substance: this group's answer genuinely is
                    the list below, and the card is not a manifest. Only the
                    naming condition moved to its own group's names. */}
                {blockedAshore === 1 && blockedAshoreNames[0]
                  ? fill(copy.blockedWarningNamed, { name: blockedAshoreNames[0] })
                  : fill(
                      pluralForm(
                        blockedAshore,
                        { one: copy.blockedWarningOne, other: copy.blockedWarningOther },
                        locale,
                      ),
                      { count: blockedAshore },
                    )}
              </p>
            ) : null}
          </>
        ) : booked === 0 ? (
          <p className="mt-2 text-base text-muted">{copy.noneBooked}</p>
        ) : boarded === booked && blocked === 0 && crewAccountedFor ? (
          // The manifest already celebrates this milestone ("Roll call complete
          // ✦"); Today watches the same board without ever visiting the
          // manifest, so it earns the same coral rise-in moment here (principle
          // 3) instead of readiness copy that's gone stale the moment the boat
          // is actually full.
          //
          // **`crewAccountedFor` is what stops the two disagreeing.** This
          // fired on `boarded === booked` alone, and `boarded` counts bookings
          // — so Today threw confetti over a boat the manifest, reading the
          // same departure, correctly refused to close because the divemaster
          // had no result (issue #789). With every diver aboard the diver half
          // is already satisfied, so this condition is strictly stronger than
          // the manifest's own verdict: the card cannot celebrate a checkpoint
          // the manifest holds open.
          // The 🎉 that used to lead this line is gone with the hand-rolled
          // panel: the coral is the celebration, and Today's own all-clear line
          // keeps its 🤙 inside the sentence in the bundle, where a translator
          // can see it. One mechanism (EarnedMoment's doc comment).
          <EarnedMomentLine className="mt-1.5">{copy.everyoneAboard}</EarnedMomentLine>
        ) : boarded === booked && blocked === 0 && crewReason !== "crew_none_assigned" ? (
          // Every diver aboard, and a crew member the boat named has no result
          // — which is the one state where somebody may still be in the water
          // and nothing else on this card would say so. One line rather than
          // the manifest's four-way breakdown of *which* crew reason: this is a
          // glance, and the manifest is one tap away.
          //
          // `crew_none_assigned` deliberately falls through to the line below
          // instead. A departure with no crew rostered is a coverage gap the
          // page already raises as its own row, and saying it twice on one
          // screen buys nothing.
          <p className="mt-1.5 text-base font-medium text-warning">{copy.crewRollCallOpen}</p>
        ) : blocked === 0 ? (
          <p className="mt-1.5 text-base font-medium text-success">{copy.clearToBoard}</p>
        ) : null}
      </div>

      {/* Crew is one quiet line — names when assigned, a plain gap note when
          not. Editing is the rare act (once a day, not once a glance), so the
          controls live behind the line's own disclosure rather than sitting
          open on every card (principle 8: collapse the rare path). Native
          <details>: keyboard and screen-reader behavior for free. */}
      <details className="group/crew mt-3">
        <summary className="-mx-2 flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-lg px-2 text-sm transition-colors select-none [&::-webkit-details-marker]:hidden hover:bg-surface-sunken">
          <DisclosureCaret className="text-muted group-open/crew:rotate-90" />
          {/* The affordance sits beside its object, not across the card. */}
          <span className="min-w-0 truncate text-muted">
            {localCrew.length > 0 ? fill(copy.crewLine, { names: crewNames }) : copy.noCrewAssigned}
          </span>
          <span className="shrink-0 font-medium text-primary">{copy.editCrew}</span>
        </summary>
        <div className="mt-2 flex flex-col gap-2 pb-1 pl-5">
          {localCrew.length > 0 ? (
            <ul className="flex flex-wrap items-center gap-x-3 gap-y-1">
              {localCrew.map((c) => (
                <li
                  key={c.id}
                  onAnimationEnd={() => {
                    if (c.id === justAddedId) setJustAddedId(null);
                  }}
                  // Quiet text with its own remove target, not a bordered
                  // capsule: a crew name is a fact the row already owns, and
                  // `Badge` is the app's only pill (ADR
                  // 20260827-clearwater-surface-language, decision 3).
                  className={`inline-flex items-center gap-1 text-sm ${
                    c.id === justAddedId ? "animate-scale-in" : ""
                  }`}
                >
                  {c.fullName}
                  {/* A square 44px target holding one glyph, through the shared
                      `size: "icon"` rather than a hand-spelled `min-h-11
                      min-w-11` — this button was one of the four spellings that
                      size exists to end (see components/ui/button.ts), and the
                      trip page's own crew chip already wears it. */}
                  <button
                    type="button"
                    onClick={() => handleUnassign(c.id)}
                    className={buttonClass({ variant: "danger-ghost", size: "icon" })}
                    aria-label={fill(copy.unassignAria, { name: c.fullName })}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          {availableStaff.filter((staff) => !localCrew.some((crew) => crew.id === staff.id))
            .length > 0 ? (
            // `Field`, not a hand-stacked `<label>` wrapping its control: that
            // shape is exactly what the wrapper exists to prevent
            // (docs/design/forms-and-controls.md). Sized by the field wrapper
            // rather than by a width class on the select — `controlClass`
            // already carries `w-full`, and two width utilities resolve by
            // stylesheet order rather than class order (same trap as `min-h-*`,
            // see components/ui/button.ts). Full width on a phone, shrink to
            // content from `sm` up, which is what the old `sm:w-auto` bought.
            // The `aria-label` stays: several cards render this control, so each
            // one needs an accessible name that names its own departure.
            <Field label={copy.assignCrewLabel} className="sm:w-fit">
              <select
                aria-label={fill(copy.assignCrewMemberAria, { title: departure.title })}
                defaultValue=""
                onChange={(event) => {
                  const staffId = event.currentTarget.value;
                  event.currentTarget.value = "";
                  void handleAssign(staffId);
                }}
                className={`${controlClass} text-sm`}
              >
                <option value="">{copy.assignCrewOption}</option>
                {availableStaff
                  .filter((staff) => !localCrew.some((crew) => crew.id === staff.id))
                  .map((staff) => (
                    <option key={staff.id} value={staff.id}>
                      {staff.fullName}
                    </option>
                  ))}
              </select>
            </Field>
          ) : null}
          {/* `FormStatus`, not a hand-rolled `role="alert"` paragraph: it is the
              shared shape for "this control's own attempt was refused", and it
              carries the ❌ glyph this was missing — without one the refusal
              reached a colourblind reader as ordinary small text. */}
          <FormStatus tone="danger">{assignError ? copy.assignFailed : undefined}</FormStatus>
        </div>
      </details>
    </SectionCard>
  );
}

/**
 * The situational-awareness strip: only boats that sail today, because a
 * departure three weeks out is a Schedule question, not a Today question.
 */
export function DepartureBoard({
  departures,
  shopSlug,
  timeZone,
  locale,
  crewedTripIds,
  availableStaff,
  updateCrewAction,
  copy,
}: {
  departures: readonly DepartureSummary[];
  shopSlug: string;
  timeZone: string;
  locale: string;
  /** Trips the signed-in staffer crews — badged so their boat reads first. */
  crewedTripIds?: readonly string[];
  availableStaff: { id: string; fullName: string; roles: string[] }[];
  updateCrewAction: (
    tripId: string,
    change: { personId: string; operation: "assign" | "unassign" },
  ) => Promise<{ ok: boolean }>;
  copy: DepartureBoardCopy;
}) {
  if (departures.length === 0) return null;
  const crewed = new Set(crewedTripIds ?? []);
  return (
    <section aria-labelledby="departures-heading" className="mb-8">
      {/* The heading and nothing else — the cards are their own explanation,
          and the how-to sentence that used to sit here rendered every single
          day for staff who boarded a boat yesterday. */}
      <h2 id="departures-heading" className="text-lg font-semibold">
        {copy.sailingToday}
      </h2>

      {/* Two abreast on a wide screen once more than one boat sails, so a
          two-boat day answers "can they sail?" in the height of one card.
          A single boat keeps the full line — the board is shaped by the day. */}
      <ul className={`mt-4 grid gap-3 ${departures.length > 1 ? "lg:grid-cols-2" : ""}`}>
        {departures.map((departure) => (
          <DepartureCard
            key={departure.tripId}
            departure={departure}
            shopSlug={shopSlug}
            timeZone={timeZone}
            locale={locale}
            crewed={crewed.has(departure.tripId)}
            availableStaff={availableStaff}
            updateCrewAction={updateCrewAction}
            copy={copy}
          />
        ))}
      </ul>
    </section>
  );
}
