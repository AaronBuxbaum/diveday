"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { BoardingBar } from "@/components/BoardingBar";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { DisclosureCaret } from "@/components/ui/DisclosureCaret";
import type { DepartureSummary } from "@/db/today";
import { fill, pluralForm } from "@/i18n/fill";
import { formatTime, formatTimeRange } from "@/lib/format";

export type DepartureBoardCopy = {
  crewingBadge: string;
  courseSession: string;
  bookedOfCapacity: string;
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
  blockedWarningNamed: string;
  blockedWarningOne: string;
  blockedWarningOther: string;
  noneBooked: string;
  everyoneAboard: string;
  clearToBoard: string;
  sailingToday: string;
  sailingTodaySubtitle: string;
};

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
  const { blocked, blockedNames, ready, boarded, booked, capacity } = departure;
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
    } catch {
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
    } catch {
      setAssignError(true);
    }
  };

  const crewNames = localCrew.map((c) => c.fullName).join(", ");

  return (
    <li className="rounded-2xl border border-border bg-surface p-4 shadow-sm sm:p-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 text-2xl font-bold tracking-tight tabular-nums">
            {formatTime(departure.startsAt, locale, timeZone)}
            {crewed ? <Badge tone="primary">{copy.crewingBadge}</Badge> : null}
          </p>
          <h3 className="mt-0.5 font-semibold">{departure.title}</h3>
          {/* A fact, not a link — the action color would promise a tap. */}
          {departure.courseTitle ? (
            <p className="text-sm font-medium text-muted">
              {fill(copy.courseSession, { title: departure.courseTitle })}
            </p>
          ) : null}
          <p className="text-sm text-muted">
            {formatTimeRange(departure.startsAt, departure.endsAt, locale, timeZone)} ·{" "}
            <span className="tabular-nums">
              {fill(copy.bookedOfCapacity, { booked, capacity })}
            </span>
          </p>
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

      {/* One bar, one caption, one quiet count line — the whole readiness
          read for this boat. The bar stays decorative because the counts are
          plain text right under it (principle 6: exact numbers, and state is
          never carried by hue alone). */}
      <div className="mt-4">
        <BoardingBar boarded={boarded} ready={ready} blocked={blocked} capacity={capacity} />
        {booked > 0 ? (
          <p className="mt-2 text-sm text-muted tabular-nums">
            {fill(copy.boardingSummary, {
              boarded,
              ready,
              blocked,
              open: Math.max(0, capacity - booked),
            })}
          </p>
        ) : null}
        {blocked > 0 ? (
          // The most operational sentence on the page — read in glare at the
          // dock deciding whether the boat leaves — so it holds 16px. One
          // blocked diver is named outright: the answer, not a door to it.
          // Regular weight and ink on purpose: the bar's red segment and the
          // counts line already state the blocked fact, and a third statement
          // in bold red made the card sound an alarm three times for one fact
          // (principle 9). The words carry the state; the name is the value.
          <p className="mt-1.5 text-base">
            {blocked === 1 && blockedNames[0]
              ? fill(copy.blockedWarningNamed, { name: blockedNames[0] })
              : fill(
                  pluralForm(
                    blocked,
                    { one: copy.blockedWarningOne, other: copy.blockedWarningOther },
                    locale,
                  ),
                  { count: blocked },
                )}
          </p>
        ) : booked === 0 ? (
          <p className="mt-2 text-base text-muted">{copy.noneBooked}</p>
        ) : boarded === booked ? (
          // The manifest already celebrates this milestone ("Roll call complete
          // ✦"); Today watches the same board without ever visiting the
          // manifest, so it earns the same coral rise-in moment here (principle
          // 3) instead of readiness copy that's gone stale the moment the boat
          // is actually full.
          <p className="rise-in mt-1.5 inline-block rounded-lg border border-accent/40 bg-accent/10 px-3 py-1.5 text-base font-semibold">
            <span aria-hidden="true">🎉 </span>
            {copy.everyoneAboard}
          </p>
        ) : (
          <p className="mt-1.5 text-base font-medium text-success">{copy.clearToBoard}</p>
        )}
      </div>

      {/* Crew is one quiet line — names when assigned, a plain gap note when
          not. Editing is the rare act (once a day, not once a glance), so the
          controls live behind the line's own disclosure rather than sitting
          open on every card (principle 8: collapse the rare path). Native
          <details>: keyboard and screen-reader behavior for free. */}
      <details className="group/crew mt-3">
        <summary className="-mx-2 flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-lg px-2 text-sm transition-colors duration-200 select-none [&::-webkit-details-marker]:hidden hover:bg-surface-sunken">
          <DisclosureCaret className="text-muted group-open/crew:rotate-90" />
          {/* The affordance sits beside its object, not across the card. */}
          <span className="min-w-0 truncate text-muted">
            {localCrew.length > 0 ? fill(copy.crewLine, { names: crewNames }) : copy.noCrewAssigned}
          </span>
          <span className="shrink-0 font-medium text-primary">{copy.editCrew}</span>
        </summary>
        <div className="mt-2 flex flex-col gap-2 pb-1 pl-5">
          {localCrew.length > 0 ? (
            <ul className="flex flex-wrap gap-1.5">
              {localCrew.map((c) => (
                <li
                  key={c.id}
                  onAnimationEnd={() => {
                    if (c.id === justAddedId) setJustAddedId(null);
                  }}
                  className={`inline-flex items-center gap-1 rounded-full border border-border-strong bg-surface py-0.5 pl-2.5 text-xs font-medium ${
                    c.id === justAddedId ? "animate-scale-in" : ""
                  }`}
                >
                  {c.fullName}
                  <button
                    type="button"
                    onClick={() => handleUnassign(c.id)}
                    className="ml-1 flex min-h-11 min-w-11 items-center justify-center rounded-full text-sm font-bold text-muted hover:bg-danger/10 hover:text-danger"
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
            <label className="flex flex-col gap-1 text-sm font-medium sm:flex-row sm:items-center sm:gap-2">
              {copy.assignCrewLabel}
              <select
                aria-label={fill(copy.assignCrewMemberAria, { title: departure.title })}
                defaultValue=""
                onChange={(event) => {
                  const staffId = event.currentTarget.value;
                  event.currentTarget.value = "";
                  void handleAssign(staffId);
                }}
                className="min-h-11 w-full rounded-lg border border-border bg-surface px-3 text-sm text-foreground sm:w-auto"
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
            </label>
          ) : null}
          {assignError ? (
            <p role="alert" className="text-xs font-semibold text-danger">
              {copy.assignFailed}
            </p>
          ) : null}
        </div>
      </details>
    </li>
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
    <section aria-labelledby="departures-heading" className="mb-10">
      <h2 id="departures-heading" className="text-lg font-semibold">
        {copy.sailingToday}
      </h2>
      <p className="mt-1 text-sm text-muted">{copy.sailingTodaySubtitle}</p>

      <ul className="mt-4 flex flex-col gap-3">
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
