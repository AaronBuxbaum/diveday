import Link from "next/link";
import type { ComponentProps } from "react";
import { buttonClass } from "@/components/ui/button";
import { TripAddBookingLink } from "./TripAddBookingLink";
import { TripPageHeader } from "./TripPageHeader";

/** The same trip identity, with explicit doors to guest administration and Deck. */
export function TripFolioHeader({
  doors,
  ...props
}: ComponentProps<typeof TripPageHeader> & {
  doors: {
    tripHref: string;
    allowAdd: boolean;
    addLabel: string;
    addAriaLabel: string;
    deckLabel: string;
  };
}) {
  return (
    <TripPageHeader
      {...props}
      stackActionsOnMobile
      compactForFolio
      className="mb-0"
      actions={
        <Link href={`${doors.tripHref}/manifest`} className={buttonClass({})}>
          {doors.deckLabel}
        </Link>
      }
      headerAside={
        doors.allowAdd ? (
          <span className="contents group-has-[[data-guest-folio]]/folio:hidden">
            <TripAddBookingLink
              tripHref={doors.tripHref}
              label={doors.addLabel}
              ariaLabel={doors.addAriaLabel}
            />
          </span>
        ) : undefined
      }
    />
  );
}
