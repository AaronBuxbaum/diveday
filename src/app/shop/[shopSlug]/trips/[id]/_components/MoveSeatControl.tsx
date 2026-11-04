"use client";

import { useState } from "react";
import { AutoOpenDetails } from "@/components/AutoOpenDetails";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { controlClass, Field, FormStatus } from "@/components/ui/form";
import type { SeatMove } from "./roster-model";

/** Presentation only: a deliberate destination; the action still checks eligibility and capacity. */
export function MoveSeatControl({
  bookingId,
  targets,
  action,
  copy,
  carriedChartersNote,
  partyNote,
  partySeats = 1,
  refusal,
}: {
  bookingId: string;
  targets: readonly (SeatMove["targets"][number] & { availability: string })[];
  action: SeatMove["action"];
  copy: {
    trigger: string;
    label: string;
    note: string;
    choose: string;
    pending: string;
    submit: string;
    cancel: string;
  };
  carriedChartersNote?: string;
  /** Said on a party lead's form, which moves the whole party and posts `party=1` (#2556). */
  partyNote?: string;
  /** The seats that move together; a departure with fewer left cannot be chosen. */
  partySeats?: number;
  refusal?: string;
}) {
  const [selected, setSelected] = useState("");
  const groups = new Map<string, (typeof targets)[number][]>();
  for (const target of targets) {
    const day = groups.get(target.localDay) ?? [];
    day.push(target);
    groups.set(target.localDay, day);
  }
  const usableChoice = targets.some(
    (target) => target.id === selected && target.seatsLeft >= partySeats,
  );
  return (
    <AutoOpenDetails
      id={`move-booking-${bookingId}`}
      openOnHash={`move-booking-${bookingId}`}
      open={Boolean(refusal)}
      className="group/move-seat basis-full scroll-mt-24"
    >
      <summary
        className={buttonClass({
          variant: "link",
          size: "sm",
          flush: true,
          className: "list-none [&::-webkit-details-marker]:hidden",
        })}
      >
        {copy.trigger}
      </summary>
      <form action={action} className="mt-2 flex flex-col gap-3">
        <input type="hidden" name="bookingId" value={bookingId} />
        {partyNote ? <input type="hidden" name="party" value="1" /> : null}
        <FormStatus className="text-base">{refusal}</FormStatus>
        <Field label={copy.label} description={copy.note} htmlFor={`move-seat-${bookingId}`}>
          <select
            id={`move-seat-${bookingId}`}
            name="toTripId"
            required
            value={selected}
            onChange={(event) => setSelected(event.currentTarget.value)}
            className={controlClass}
          >
            <option value="">{copy.choose}</option>
            {[...groups].map(([day, entries]) => (
              <optgroup key={day} label={entries[0].dayLabel}>
                {entries.map((target) => (
                  <option
                    key={target.id}
                    value={target.id}
                    disabled={target.seatsLeft < partySeats}
                  >
                    {target.dayLabel} · {target.timeLabel} · {target.label} · {target.availability}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </Field>
        {partyNote ? <p className="text-base">{partyNote}</p> : null}
        {carriedChartersNote ? (
          <p className="text-base text-warning-strong">{carriedChartersNote}</p>
        ) : null}
        <div className="flex flex-wrap gap-3">
          <SubmitButton
            pendingLabel={copy.pending}
            disabled={!usableChoice}
            className={buttonClass({ variant: "secondary", size: "sm" })}
          >
            {copy.submit}
          </SubmitButton>
          <button
            type="button"
            className={buttonClass({ variant: "ghost", size: "sm" })}
            onClick={(event) => {
              setSelected("");
              const disclosure = event.currentTarget.closest("details");
              if (disclosure) {
                disclosure.open = false;
                disclosure.querySelector("summary")?.focus();
              }
            }}
          >
            {copy.cancel}
          </button>
        </div>
      </form>
    </AutoOpenDetails>
  );
}
