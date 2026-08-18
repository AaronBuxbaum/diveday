import Link from "next/link";
import type { ReactNode } from "react";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import type { BookableDiver } from "@/db/divers";

/**
 * The returning-diver picker's result rows: name, the one contact line, and a
 * one-tap seat button per row.
 *
 * Shared so the three doors cannot drift on the row's shape or its accessible
 * name (each button repeats the same visible label, so every one carries a
 * per-person `aria-label`). What legitimately differs between doors is passed
 * in: whether the name links to the diver's record, an extra line under the
 * contact line (the Guests tab's "rental fit on file"), and the row's surface
 * tone.
 */
export function PersonCandidateList({
  candidates,
  tripId,
  seatAction,
  inviteAction,
  personHref,
  extraLine,
  addLabel,
  pendingLabel,
  addPersonAriaLabel,
  inviteLabel,
  invitePendingLabel,
  invitePersonAriaLabel,
  noEmailOnFile,
  rowClassName = "bg-surface-sunken",
  className = "",
}: {
  candidates: BookableDiver[];
  /**
   * Submitted as a hidden field rather than bound into the action: seating a
   * diver goes through the shared `seatExistingDiverAction`
   * (src/app/actions/seat-diver.ts), and every door hands it the same
   * `tripId` + `personId` pair — including the trip-first ones (the counter
   * walk-in, the global Add-booking door) where the boat is chosen in the form.
   */
  tripId: string;
  seatAction?: (formData: FormData) => void;
  inviteAction?: (formData: FormData) => void;
  /** Link the name at a diver's record, or `null` to render it as plain text. */
  personHref?: ((personId: string) => string) | null;
  /** An extra line under the contact line, per candidate. */
  extraLine?: (candidate: BookableDiver) => ReactNode;
  addLabel?: string;
  pendingLabel?: string;
  addPersonAriaLabel?: (name: string) => string;
  inviteLabel?: string;
  invitePendingLabel?: string;
  invitePersonAriaLabel?: (name: string) => string;
  noEmailOnFile: string;
  rowClassName?: string;
  className?: string;
}) {
  return (
    <ul className={`grid gap-2 ${className}`}>
      {candidates.map((candidate) => {
        const { person } = candidate;
        return (
          <li
            key={person.id}
            className={`flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border px-4 py-3 ${rowClassName}`}
          >
            <div className="min-w-0">
              {personHref ? (
                <Link
                  href={personHref(person.id)}
                  className="font-medium text-primary hover:underline"
                >
                  {person.fullName}
                </Link>
              ) : (
                <p className="font-medium">{person.fullName}</p>
              )}
              <p className="text-sm text-muted">{person.email ?? noEmailOnFile}</p>
              {extraLine?.(candidate)}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {inviteAction && inviteLabel ? (
                <form action={inviteAction}>
                  <input type="hidden" name="tripId" value={tripId} />
                  <input type="hidden" name="personId" value={person.id} />
                  <SubmitButton
                    pendingLabel={invitePendingLabel ?? "Inviting…"}
                    ariaLabel={
                      invitePersonAriaLabel
                        ? invitePersonAriaLabel(person.fullName)
                        : `Invite ${person.fullName}`
                    }
                    disabled={!person.email}
                    className={buttonClass({ variant: "secondary", size: "sm" })}
                  >
                    {inviteLabel}
                  </SubmitButton>
                </form>
              ) : null}
              {seatAction && addLabel && pendingLabel && addPersonAriaLabel ? (
                <form action={seatAction}>
                  <input type="hidden" name="tripId" value={tripId} />
                  <input type="hidden" name="personId" value={person.id} />
                  <SubmitButton
                    pendingLabel={pendingLabel}
                    ariaLabel={addPersonAriaLabel(person.fullName)}
                    className={buttonClass({ size: "sm" })}
                  >
                    {addLabel}
                  </SubmitButton>
                </form>
              ) : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
