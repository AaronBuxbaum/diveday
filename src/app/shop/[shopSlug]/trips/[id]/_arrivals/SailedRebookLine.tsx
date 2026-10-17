import Link from "next/link";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass, tapTargetLinkClass } from "@/components/ui/button";
import { RowActionForm } from "./RowActionForm";
import type { SailedRebookCopy } from "./salvage-copy";

/**
 * **One sailed diver's next dive, under their name** (fifth-loop ideas, item
 * 4): "Booked Sat 11:30 AM" and nothing more, or "Nothing else booked · Thu
 * 7:00 AM has 3 seats" with "Add them" and "Email them this date", the no-show
 * salvage's two doors. Not on paper: the printed record is who sailed.
 */
export function SailedRebookLine({
  copy,
  offerAction,
}: {
  copy: SailedRebookCopy;
  offerAction: (formData: FormData) => Promise<void>;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pb-3 text-sm print:hidden">
      <p className="text-muted">{copy.line}</p>
      {copy.add ? (
        <Link
          href={copy.add.href}
          aria-label={copy.add.ariaLabel}
          className={`${tapTargetLinkClass} font-medium text-primary hover:underline`}
        >
          {copy.add.label}
        </Link>
      ) : null}
      {copy.offer ? (
        <RowActionForm action={offerAction} sendFailedLabel={copy.offer.sendFailed}>
          <input type="hidden" name="offerTripId" value={copy.offer.tripId} />
          <input type="hidden" name="personId" value={copy.offer.personId} />
          <SubmitButton
            pendingLabel={copy.offer.pending}
            ariaLabel={copy.offer.ariaLabel}
            className={buttonClass({ variant: "secondary", size: "sm" })}
          >
            {copy.offer.label}
          </SubmitButton>
        </RowActionForm>
      ) : null}
    </div>
  );
}
