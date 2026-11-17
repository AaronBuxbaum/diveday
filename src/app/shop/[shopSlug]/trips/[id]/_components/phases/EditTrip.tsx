import Link from "next/link";
import type { ComponentProps } from "react";
import { buttonClass } from "@/components/ui/button";
import { SECTION_TITLE_CLASS } from "@/components/ui/typography";
import { TripDayOperations } from "../TripDayOperations";
import { TripDetailsPanel } from "../TripDetailsPanel";

/**
 * **Edit trip** (`?view=edit`, ADR 20261117-trip-page-clock): everything
 * about the trip that is not about today. For now it hosts the trip's details
 * and the day's planning and administration as they were.
 */
export function EditTrip({
  details,
  operations,
  labels,
  doneHref,
}: {
  details: ComponentProps<typeof TripDetailsPanel>;
  operations: ComponentProps<typeof TripDayOperations>;
  labels: { heading: string; done: string };
  doneHref: string;
}) {
  return (
    <section data-phase-panel="edit" className="space-y-10">
      <div className="flex items-center justify-between gap-4">
        <h2 className={SECTION_TITLE_CLASS}>{labels.heading}</h2>
        <Link href={doneHref} className={buttonClass({ variant: "ghost", size: "sm" })}>
          {labels.done}
        </Link>
      </div>
      <TripDetailsPanel {...details} />
      <TripDayOperations {...operations} />
    </section>
  );
}
