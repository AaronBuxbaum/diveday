"use client";

import Link from "next/link";
import { useState } from "react";
import { FlashParams } from "@/components/FlashParams";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { controlClass, DateField, Field } from "@/components/ui/form";
import { ShopNotice } from "@/components/ui/outcome";
import { SECTION_TITLE_CLASS } from "@/components/ui/typography";
import type { readScheduleDay } from "@/features/schedule-day";
import { fill } from "@/i18n/fill";
import { moveDayPersonAction } from "../day-actions";

type Row = Awaited<ReturnType<typeof readScheduleDay>>[number];
export type DayCopy = {
  day: string;
  week: string;
  chooseDay: string;
  showDay: string;
  empty: string;
  crew: string;
  divers: string;
  noCrew: string;
  noDivers: string;
  move: string;
  moveTo: string;
  choose: string;
  submit: string;
  cancel: string;
  previewClash: string;
  moved: string;
  refused: string;
  busy: string;
  clash: string;
  attention: string;
  noBoat: string;
  pending: string;
  party: string;
  standingClash: string;
  absent: string;
  identityHeld: string;
  partyIdentityHeld: string;
  hullClash: string;
  overCapacity: string;
  shore: string;
  pool: string;
};

type DisplayRow = Row & { time: string; totalPersonWarning: string | null; proof: string };

function vessel(row: Row, copy: DayCopy) {
  return row.diveMode === "shore"
    ? copy.shore
    : row.diveMode === "pool"
      ? copy.pool
      : (row.boatName ?? copy.noBoat);
}

function overlaps(a: Row, b: Row) {
  return a.windows.some((left) =>
    b.windows.some((right) => left.startsAt < right.endsAt && left.endsAt > right.startsAt),
  );
}

function Move({
  shopSlug,
  day,
  source,
  personId,
  personName,
  kind,
  rows,
  copy,
  party,
}: {
  shopSlug: string;
  day: string;
  source: DisplayRow;
  personId: string;
  personName: string;
  kind: "crew" | "diver";
  rows: DisplayRow[];
  copy: DayCopy;
  party?: boolean;
}) {
  const [targetId, setTargetId] = useState("");
  const target = rows.find((row) => row.tripId === targetId);
  const person =
    kind === "crew" ? personId : source.divers.find((seat) => seat.id === personId)?.personId;
  const clash =
    target &&
    person &&
    rows.some(
      (row) =>
        overlaps(target, row) &&
        (((row.tripId !== source.tripId || kind === "diver") &&
          (row.tripId !== target.tripId || kind === "crew") &&
          row.crew.some((member) => member.id === person)) ||
          ((row.tripId !== source.tripId || kind === "crew") &&
            (row.tripId !== target.tripId || kind === "diver") &&
            row.divers.some((seat) => seat.status === "booked" && seat.personId === person))),
    );
  if (rows.length < 2) return null;
  return (
    <details className="mt-1">
      <summary
        aria-label={`${copy.move} ${personName}`}
        className={buttonClass({ variant: "link", flush: "padded" })}
      >
        {copy.move}
      </summary>
      <form
        action={moveDayPersonAction.bind(null, shopSlug, day)}
        className="mt-2 flex flex-col gap-2"
      >
        <input type="hidden" name="kind" value={kind} />
        <input type="hidden" name="from" value={source.tripId} />
        <input type="hidden" name="fromProof" value={source.proof} />
        <input type="hidden" name="toProof" value={target?.proof ?? ""} />
        <input type="hidden" name="person" value={personId} />
        <label>
          {copy.moveTo}
          <select
            className={controlClass}
            name="to"
            value={targetId}
            onChange={(event) => setTargetId(event.currentTarget.value)}
            required
          >
            <option value="">{copy.choose}</option>
            {rows
              .filter((row) => row.tripId !== source.tripId)
              .map((row) => (
                <option key={row.tripId} value={row.tripId}>
                  {row.time} · {vessel(row, copy)} · {row.title}
                </option>
              ))}
          </select>
        </label>
        {clash ? (
          <p role="alert" className="text-warning-strong">
            {copy.previewClash}
          </p>
        ) : null}
        {party ? <p>{copy.party}</p> : null}
        <div className="flex gap-3">
          <SubmitButton
            pendingLabel={copy.pending}
            disabled={!targetId || Boolean(clash)}
            className={buttonClass({ variant: "secondary", size: "sm" })}
          >
            {copy.submit}
          </SubmitButton>
          <button
            type="button"
            className={buttonClass({ variant: "ghost", size: "sm" })}
            onClick={(event) => {
              setTargetId("");
              const details = event.currentTarget.closest("details");
              if (details) {
                details.open = false;
                details.querySelector("summary")?.focus();
              }
            }}
          >
            {copy.cancel}
          </button>
        </div>
      </form>
    </details>
  );
}

export function DayBoard({
  shopSlug,
  day,
  rows,
  copy,
  notice,
}: {
  shopSlug: string;
  day: string;
  rows: DisplayRow[];
  copy: DayCopy;
  notice?: string;
}) {
  const path = `/shop/${shopSlug}/schedule/board`;
  const message =
    notice === "moved"
      ? copy.moved
      : notice === "clash"
        ? copy.clash
        : notice === "attention"
          ? copy.attention
          : notice === "refused"
            ? copy.refused
            : notice === "busy"
              ? copy.busy
              : null;
  return (
    <section className="space-y-6">
      <FlashParams params={["notice"]} />
      <div className="flex flex-wrap items-end gap-4">
        <Link
          href={`${path}?week=${encodeURIComponent(day)}`}
          className={buttonClass({ variant: "secondary", size: "sm" })}
        >
          {copy.week}
        </Link>
        <form action={path} className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="view" value="day" />
          <Field label={copy.chooseDay} markRequired={false}>
            <DateField name="day" defaultValue={day} required />
          </Field>
          <SubmitButton
            pendingLabel={copy.showDay}
            className={buttonClass({ variant: "secondary", size: "sm" })}
          >
            {copy.showDay}
          </SubmitButton>
        </form>
      </div>
      {message ? (
        <ShopNotice tone={notice === "moved" ? "success" : "warning"}>{message}</ShopNotice>
      ) : null}
      {rows.length === 0 ? (
        <p>{copy.empty}</p>
      ) : (
        <ol className="grid items-start gap-4 lg:grid-cols-2">
          {rows.map((row) => (
            <li key={row.tripId} className="rounded-card border border-edge p-4">
              <h2 className={SECTION_TITLE_CLASS}>
                <Link
                  className="inline-flex min-h-11 items-center"
                  href={`/shop/${shopSlug}/trips/${row.tripId}`}
                >
                  {row.title}
                </Link>
              </h2>
              <p>
                {row.time} · {vessel(row, copy)}
              </p>
              {row.boatClashes.map((clash) => (
                <p role="alert" key={clash.otherTripId} className="mt-2 text-warning-strong">
                  {fill(copy.hullClash, { boat: clash.boatName, departure: clash.otherTitle })}
                </p>
              ))}
              {row.overSellableCapacity ? (
                <p role="alert" className="mt-2 text-warning-strong">
                  {copy.overCapacity}
                </p>
              ) : null}
              {row.totalPersonWarning ? (
                <p role="alert" className="mt-2 text-warning-strong">
                  {row.totalPersonWarning}
                </p>
              ) : null}
              {row.collisions.map((clash) => {
                const name =
                  row.crew.find((member) => member.id === clash.personId)?.name ??
                  row.divers.find((seat) => seat.personId === clash.personId)?.name;
                return name ? (
                  <p
                    role="alert"
                    key={`${clash.personId}:${clash.otherTripId}`}
                    className="mt-2 text-warning-strong"
                  >
                    {fill(copy.standingClash, { name, departure: clash.otherTitle })}
                  </p>
                ) : null;
              })}
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <details>
                  <summary className="cursor-pointer font-semibold">
                    {copy.crew} ({row.crew.length})
                  </summary>
                  {row.crew.length ? (
                    <ul>
                      {row.crew.map((member) => (
                        <li key={member.id} className="py-2">
                          {member.name}
                          <Move
                            shopSlug={shopSlug}
                            day={day}
                            source={row}
                            personId={member.id}
                            personName={member.name}
                            kind="crew"
                            rows={rows}
                            copy={copy}
                          />
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p>{copy.noCrew}</p>
                  )}
                </details>
                <details>
                  <summary className="cursor-pointer font-semibold">
                    {copy.divers} ({row.divers.length})
                  </summary>
                  {row.divers.length ? (
                    <ul>
                      {row.divers.map((seat) => (
                        <li key={seat.id} className="py-2">
                          {seat.name}
                          {seat.status === "no_show" ? <span> · {copy.absent}</span> : null}
                          {seat.identityHeld ||
                          row.divers.some(
                            (other) => other.partyLeadBookingId === seat.id && other.identityHeld,
                          ) ? (
                            <p>{seat.identityHeld ? copy.identityHeld : copy.partyIdentityHeld}</p>
                          ) : (
                            <Move
                              shopSlug={shopSlug}
                              day={day}
                              source={row}
                              personId={seat.id}
                              personName={seat.name}
                              kind="diver"
                              rows={rows}
                              copy={copy}
                              party={row.divers.some(
                                (other) => other.partyLeadBookingId === seat.id,
                              )}
                            />
                          )}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p>{copy.noDivers}</p>
                  )}
                </details>
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
