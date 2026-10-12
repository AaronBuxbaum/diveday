import type { ComponentProps } from "react";
import { staffTranslator } from "@/i18n/staff-messages";
import { RescheduleNotice } from "../../../_components/RescheduleNotice";
import { DetailsSection } from "./DetailsSection";

/**
 * The details form, and under its Save row whatever the save set going: a
 * retime's reschedule notice (ux review 2026-10-11, item 1), "Telling 8 divers
 * the new time…" with Undo. Outside the form, because the hold's Undo and
 * "Tell them" are a form of their own.
 */
export function DetailsEditor({
  held,
  tell,
  ...props
}: ComponentProps<typeof DetailsSection> & { held?: string; tell?: string }) {
  return (
    <>
      <DetailsSection {...props} />
      {held ? (
        <div className="mt-3">
          <RescheduleNotice
            shopId={props.trip.shopId}
            heldId={held}
            tell={tell}
            tripId={props.trip.id}
            t={staffTranslator(props.locale)}
          />
        </div>
      ) : null}
    </>
  );
}
