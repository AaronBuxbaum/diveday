"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { buttonClass } from "@/components/ui/button";
import type { DepartureSummary } from "@/db/today";
import { formatTime, formatTimeRange } from "@/lib/format";

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
  crewed = false,
  availableStaff,
  updateCrewAction,
}: {
  departure: DepartureSummary;
  shopSlug: string;
  timeZone: string;
  crewed?: boolean;
  availableStaff: { id: string; fullName: string; roles: string[] }[];
  updateCrewAction: (
    tripId: string,
    change: { personId: string; operation: "assign" | "unassign" },
  ) => Promise<{ ok: boolean }>;
}) {
  const { blocked, ready, boarded, booked, capacity } = departure;
  const [localCrew, setLocalCrew] = useState(departure.crew || []);

  useEffect(() => {
    setLocalCrew(departure.crew || []);
  }, [departure.crew]);

  const handleAssign = async (staffId: string) => {
    const staff = availableStaff.find((s) => s.id === staffId);
    if (!staff) return;
    if (localCrew.some((c) => c.id === staffId)) return;

    const updated = [...localCrew, staff];
    setLocalCrew(updated);

    try {
      const res = await updateCrewAction(departure.tripId, {
        personId: staffId,
        operation: "assign",
      });
      if (!res.ok) {
        setLocalCrew(departure.crew || []);
      }
    } catch {
      setLocalCrew(departure.crew || []);
    }
  };

  const handleUnassign = async (staffId: string) => {
    const updated = localCrew.filter((c) => c.id !== staffId);
    setLocalCrew(updated);

    try {
      const res = await updateCrewAction(departure.tripId, {
        personId: staffId,
        operation: "unassign",
      });
      if (!res.ok) {
        setLocalCrew(departure.crew || []);
      }
    } catch {
      setLocalCrew(departure.crew || []);
    }
  };

  return (
    <li className="rounded-2xl border border-border bg-surface-sunken p-4 shadow-sm sm:p-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 text-2xl font-bold tracking-tight tabular-nums">
            {formatTime(departure.startsAt, "en-US", timeZone)}
            {crewed ? (
              <span className="rounded-full bg-primary/10 px-3 py-1 text-sm font-semibold text-primary">
                You’re crewing
              </span>
            ) : null}
          </p>
          <h3 className="mt-0.5 font-semibold">{departure.title}</h3>
          {departure.courseTitle ? (
            <p className="text-sm font-medium text-primary">
              Course session · {departure.courseTitle}
            </p>
          ) : null}
          <p className="text-sm text-muted">
            {formatTimeRange(departure.startsAt, departure.endsAt, "en-US", timeZone)} ·{" "}
            <span className="tabular-nums">
              {booked} of {capacity} booked
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
            Boarding
          </Link>
          <Link
            href={`/shop/${shopSlug}/trips/${departure.tripId}/guests`}
            className={buttonClass({ variant: "secondary" })}
          >
            Open guests
          </Link>
        </div>
      </div>

      <section
        aria-label="Crew assignments drop zone"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const staffId = e.dataTransfer.getData("text/plain");
          handleAssign(staffId);
        }}
        className="mt-4 rounded-xl border border-dashed border-border bg-surface p-3 transition-colors hover:border-primary/40"
      >
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs font-bold tracking-wide text-muted uppercase">
            Assigned Crew (drag staff here to assign)
          </p>
          {availableStaff.length > 0 ? (
            <label className="flex items-center gap-2 text-sm">
              <span className="sr-only">Assign crew member to {departure.title}</span>
              <select
                aria-label={`Assign crew member to ${departure.title}`}
                defaultValue=""
                onChange={(event) => {
                  const staffId = event.currentTarget.value;
                  event.currentTarget.value = "";
                  void handleAssign(staffId);
                }}
                className="min-h-11 rounded-lg border border-border bg-surface px-3 text-sm text-foreground"
              >
                <option value="">Assign crew…</option>
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
          <p className="mt-2 text-xs text-muted">No crew assigned. Drag staff from above here.</p>
        ) : (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {localCrew.map((c) => (
              <span
                key={c.id}
                className="inline-flex items-center gap-1 rounded-full border border-border-strong bg-surface px-2.5 py-0.5 text-xs font-medium"
              >
                {c.fullName}
                <button
                  type="button"
                  onClick={() => handleUnassign(c.id)}
                  className="ml-1 text-muted hover:text-danger font-bold text-xs"
                  aria-label={`Unassign ${c.fullName}`}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
      </section>

      <div className="mt-4 grid grid-cols-3 gap-2">
        <Count label="Ready" value={ready} tone={ready > 0 ? "success" : "default"} />
        <Count label="Blocked" value={blocked} tone={blocked > 0 ? "danger" : "default"} />
        <Count label="Boarded" value={boarded} tone={boarded > 0 ? "primary" : "default"} />
      </div>
      {blocked > 0 ? (
        <p className="mt-3 text-sm font-semibold text-danger">
          <span aria-hidden="true">⚠ </span>
          {blocked} {blocked === 1 ? "diver cannot" : "divers cannot"} board yet — they are in the
          list below.
        </p>
      ) : booked === 0 ? (
        <p className="mt-3 text-sm text-muted">
          No one&apos;s booked yet — share the trip page and they&apos;ll show up here.
        </p>
      ) : boarded === booked ? (
        // The manifest already celebrates this milestone ("Roll call complete
        // ✦"); Today watches the same board without ever visiting the
        // manifest, so it earns the same coral rise-in moment here (principle
        // 3) instead of readiness copy that's gone stale the moment the boat
        // is actually full.
        <p className="rise-in mt-3 rounded-lg border border-accent/40 bg-accent/10 px-3 py-2 text-sm font-semibold">
          <span aria-hidden="true">✦ </span>
          Everyone&apos;s aboard.
        </p>
      ) : (
        <p className="mt-3 text-sm font-semibold text-success">
          <span aria-hidden="true">✓ </span>
          Everyone aboard this trip is clear to board.
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
  crewedTripIds,
  availableStaff,
  updateCrewAction,
}: {
  departures: readonly DepartureSummary[];
  shopSlug: string;
  timeZone: string;
  /** Trips the signed-in staffer crews — badged so their boat reads first. */
  crewedTripIds?: readonly string[];
  availableStaff: { id: string; fullName: string; roles: string[] }[];
  updateCrewAction: (
    tripId: string,
    change: { personId: string; operation: "assign" | "unassign" },
  ) => Promise<{ ok: boolean }>;
}) {
  if (departures.length === 0) return null;
  const crewed = new Set(crewedTripIds ?? []);
  return (
    <section aria-labelledby="departures-heading" className="mb-10">
      <h2 id="departures-heading" className="text-lg font-semibold">
        Sailing today
      </h2>
      <p className="mt-1 text-sm text-muted">
        Check divers in at the counter or run roll call from the manifest — readiness is rechecked
        the moment you board someone.
      </p>

      {availableStaff && availableStaff.length > 0 ? (
        <div className="mt-4 flex flex-wrap items-center gap-2 rounded-xl border border-border bg-surface p-3 shadow-sm">
          <span className="text-xs font-bold text-muted uppercase tracking-wider">
            Drag staff to assign:
          </span>
          <div className="flex flex-wrap gap-2">
            {availableStaff.map((staff) => (
              <button
                key={staff.id}
                type="button"
                draggable
                onDragStart={(e) => e.dataTransfer.setData("text/plain", staff.id)}
                className="cursor-grab rounded-full border border-primary/20 bg-primary/5 px-3 py-1 text-xs font-medium text-primary transition-all active:cursor-grabbing hover:bg-primary/10"
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
            crewed={crewed.has(departure.tripId)}
            availableStaff={availableStaff}
            updateCrewAction={updateCrewAction}
          />
        ))}
      </ul>
    </section>
  );
}
