"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { buttonClass } from "@/components/ui/button";
import type { DepartureSummary } from "@/db/today";
import { fill, pluralForm } from "@/i18n/fill";
import { formatTime, formatTimeRange } from "@/lib/format";

export type DepartureBoardCopy = {
  crewingBadge: string;
  courseSession: string;
  bookedOfCapacity: string;
  boarding: string;
  openGuests: string;
  crewDropZoneAria: string;
  assignCrewMemberAria: string;
  assignedCrewHeading: string;
  assignCrewOption: string;
  unassignAria: string;
  noCrewAssigned: string;
  assignCrewLabel: string;
  assignFailed: string;
  countReady: string;
  countBlocked: string;
  countBoarded: string;
  blockedWarningOne: string;
  blockedWarningOther: string;
  noneBooked: string;
  everyoneAboard: string;
  clearToBoard: string;
  sailingToday: string;
  sailingTodaySubtitle: string;
  dragStaffLabel: string;
};

/**
 * The staff pill's drag image.
 *
 * The default one is the browser's own snapshot of the element as it sits on
 * the page, and the pill's fill is translucent (`bg-primary/5`). Lifted out of
 * the page there is nothing behind that tint, so the snapshot is composited
 * onto white — which is the white square that used to follow the name around.
 * Dragging an opaque clone fixes the backdrop without changing how the pill
 * looks at rest: `color-mix` here is the same colour `bg-primary/5` resolves to
 * over the card, just flattened.
 *
 * The clone lives off-screen because `setDragImage` only reads from an element
 * that is actually in the document, and it is torn down on `dragend` — every
 * drag ends in one, cancelled or dropped.
 */
function makeDragImage(source: HTMLElement, transfer: DataTransfer): HTMLElement {
  const rect = source.getBoundingClientRect();
  const ghost = source.cloneNode(true) as HTMLElement;
  ghost.style.position = "fixed";
  ghost.style.top = "-1000px";
  ghost.style.left = "-1000px";
  ghost.style.width = `${rect.width}px`;
  ghost.style.height = `${rect.height}px`;
  ghost.style.background = "color-mix(in srgb, var(--primary) 5%, var(--surface))";
  ghost.style.pointerEvents = "none";
  document.body.append(ghost);
  transfer.setDragImage(ghost, rect.width / 2, rect.height / 2);
  return ghost;
}

/**
 * A count that has to be read at a glance in sunlight: big, tabular, and
 * labelled in words so the tone is never the only signal.
 */
function Count({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: number;
  tone?: "default" | "success" | "danger" | "primary";
}) {
  const toneClass =
    tone === "success"
      ? "text-success"
      : tone === "danger"
        ? "text-danger"
        : tone === "primary"
          ? "text-primary"
          : "text-foreground";
  return (
    <div className="rounded-xl border border-border bg-surface px-3 py-2">
      <p className="text-xs font-bold tracking-wide text-muted uppercase">{label}</p>
      <p className={`mt-0.5 text-2xl font-bold tabular-nums ${toneClass}`}>{value}</p>
    </div>
  );
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
  const { blocked, ready, boarded, booked, capacity } = departure;
  const [localCrew, setLocalCrew] = useState(departure.crew || []);
  const [assignError, setAssignError] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [justAddedId, setJustAddedId] = useState<string | null>(null);
  // dragenter/dragleave fire on every child of the drop zone as the pointer
  // crosses them, not just the zone boundary — a depth counter is the only
  // way to know when the pointer has actually left the whole zone.
  const dragDepthRef = useRef(0);

  useEffect(() => {
    setLocalCrew(departure.crew || []);
  }, [departure.crew]);

  // Confirm-then-render, not optimistic-then-rollback — same reasoning as
  // CrewSection.tsx's handleAssign/handleUnassign (this drop zone drives the
  // identical `updateCrewAction`/`course_unstaffed` server gate a staffer
  // can immediately hit by tapping "Open Guests" on this same card). An
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

  return (
    <li className="rounded-2xl border border-border bg-surface-sunken p-4 shadow-sm sm:p-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 text-2xl font-bold tracking-tight tabular-nums">
            {formatTime(departure.startsAt, locale, timeZone)}
            {crewed ? (
              <span className="rounded-full bg-primary/10 px-3 py-1 text-sm font-semibold text-primary">
                {copy.crewingBadge}
              </span>
            ) : null}
          </p>
          <h3 className="mt-0.5 font-semibold">{departure.title}</h3>
          {departure.courseTitle ? (
            <p className="text-sm font-medium text-primary">
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

      <section
        aria-label={copy.crewDropZoneAria}
        onDragOver={(e) => e.preventDefault()}
        onDragEnter={(e) => {
          e.preventDefault();
          dragDepthRef.current += 1;
          setIsDragOver(true);
        }}
        onDragLeave={() => {
          dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
          if (dragDepthRef.current === 0) {
            setIsDragOver(false);
          }
        }}
        onDrop={(e) => {
          e.preventDefault();
          dragDepthRef.current = 0;
          setIsDragOver(false);
          const staffId = e.dataTransfer.getData("text/plain");
          handleAssign(staffId);
        }}
        className={`mt-4 rounded-xl border border-dashed p-3 transition-colors hover:border-primary/40 ${
          isDragOver ? "border-primary bg-primary/5" : "border-border bg-surface"
        }`}
      >
        <div className="flex flex-col gap-2">
          <p className="text-xs font-bold tracking-wide text-muted uppercase">
            {copy.assignedCrewHeading}
          </p>
          {availableStaff.length > 0 ? (
            // The dropdown is the primary control — it works on a phone, which
            // drag-and-drop above never will. Its label is visible, not
            // sr-only, so it reads as the default way to crew a boat rather
            // than a buried fallback for the drag interaction.
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
        </div>
        {localCrew.length === 0 ? (
          <p className="mt-2 text-xs text-muted">{copy.noCrewAssigned}</p>
        ) : (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {localCrew.map((c) => (
              <span
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
                  className="ml-1 flex min-h-11 min-w-11 items-center justify-center text-muted hover:text-danger font-bold text-xs"
                  aria-label={fill(copy.unassignAria, { name: c.fullName })}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
        {assignError ? (
          <p role="alert" className="mt-2 text-xs font-semibold text-danger">
            {copy.assignFailed}
          </p>
        ) : null}
      </section>

      <div className="mt-4 grid grid-cols-3 gap-2">
        <Count label={copy.countReady} value={ready} tone={ready > 0 ? "success" : "default"} />
        <Count
          label={copy.countBlocked}
          value={blocked}
          tone={blocked > 0 ? "danger" : "default"}
        />
        <Count
          label={copy.countBoarded}
          value={boarded}
          tone={boarded > 0 ? "primary" : "default"}
        />
      </div>
      {blocked > 0 ? (
        <p className="mt-3 text-sm font-semibold text-danger">
          <span aria-hidden="true">⚠️ </span>
          {fill(
            pluralForm(
              blocked,
              { one: copy.blockedWarningOne, other: copy.blockedWarningOther },
              locale,
            ),
            { count: blocked },
          )}
        </p>
      ) : booked === 0 ? (
        <p className="mt-3 text-sm text-muted">{copy.noneBooked}</p>
      ) : boarded === booked ? (
        // The manifest already celebrates this milestone ("Roll call complete
        // ✦"); Today watches the same board without ever visiting the
        // manifest, so it earns the same coral rise-in moment here (principle
        // 3) instead of readiness copy that's gone stale the moment the boat
        // is actually full.
        <p className="rise-in mt-3 rounded-lg border border-accent/40 bg-accent/10 px-3 py-2 text-sm font-semibold">
          <span aria-hidden="true">🎉 </span>
          {copy.everyoneAboard}
        </p>
      ) : (
        <p className="mt-3 text-sm font-semibold text-success">
          <span aria-hidden="true">✅ </span>
          {copy.clearToBoard}
        </p>
      )}
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
  const dragImage = useRef<HTMLElement | null>(null);
  const clearDragImage = () => {
    dragImage.current?.remove();
    dragImage.current = null;
  };
  if (departures.length === 0) return null;
  const crewed = new Set(crewedTripIds ?? []);
  return (
    <section aria-labelledby="departures-heading" className="mb-10">
      <h2 id="departures-heading" className="text-lg font-semibold">
        {copy.sailingToday}
      </h2>
      <p className="mt-1 text-sm text-muted">{copy.sailingTodaySubtitle}</p>

      {availableStaff && availableStaff.length > 0 ? (
        <div className="mt-4 flex flex-wrap items-center gap-2 rounded-xl border border-border bg-surface p-3 shadow-sm">
          <span className="text-xs font-bold text-muted uppercase tracking-wider">
            {copy.dragStaffLabel}
          </span>
          <div className="flex flex-wrap gap-2">
            {availableStaff.map((staff) => (
              <button
                key={staff.id}
                type="button"
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData("text/plain", staff.id);
                  clearDragImage();
                  dragImage.current = makeDragImage(e.currentTarget, e.dataTransfer);
                }}
                onDragEnd={clearDragImage}
                className="min-h-11 cursor-grab rounded-full border border-primary/20 bg-primary/5 px-3 text-xs font-medium text-primary transition-all active:cursor-grabbing hover:bg-primary/10"
              >
                {staff.fullName} 👤
              </button>
            ))}
          </div>
        </div>
      ) : null}

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
