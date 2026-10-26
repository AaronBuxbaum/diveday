import type { StaffTranslator } from "@/i18n/staff-messages";
import type { LostItemFormCopy } from "./LostItemForm";
import type { LostItemRowCopy } from "./LostItemRow";

/**
 * Words for the lost-and-found client components, resolved server-side and
 * passed down as plain data (the `send-hold-copy.ts` pattern).
 */

function refusals(t: StaffTranslator) {
  return {
    empty: t("desk.lostFound.refusals.empty"),
    too_long: t("desk.lostFound.refusals.tooLong"),
    link: t("desk.lostFound.refusals.link"),
    not_found: t("desk.lostFound.refusals.notFound"),
    seat_not_on_trip: t("desk.lostFound.refusals.seatNotOnTrip"),
    not_open: t("desk.lostFound.refusals.notOpen"),
    no_owner: t("desk.lostFound.refusals.noOwner"),
    already_told: t("desk.lostFound.refusals.alreadyTold"),
    no_contact: t("desk.lostFound.refusals.noContact"),
    failed: t("desk.lostFound.refusals.failed"),
    other: t("desk.lostFound.refusals.other"),
  };
}

export function lostItemRowCopy(t: StaffTranslator): LostItemRowCopy {
  return {
    tell: t.raw("desk.lostFound.tell"),
    told: t.raw("desk.lostFound.told"),
    channels: {
      email: t("desk.lostFound.channels.email"),
      sms: t("desk.lostFound.channels.sms"),
      whatsapp: t("desk.lostFound.channels.whatsapp"),
    },
    returned: t("desk.lostFound.returned"),
    more: t("shared.shopSections.more"),
    discarded: t("desk.lostFound.discarded"),
    reopen: t("desk.lostFound.reopen"),
    unclaimed: t("desk.lostFound.unclaimed"),
    statusReturned: t("desk.lostFound.statusReturned"),
    statusDiscarded: t("desk.lostFound.statusDiscarded"),
    refusals: refusals(t),
  };
}

export function lostItemFormCopy(t: StaffTranslator): LostItemFormCopy {
  return {
    description: t("desk.lostFound.description"),
    seat: t("desk.lostFound.seat"),
    noSeat: t("desk.lostFound.noSeat"),
    submit: t("desk.lostFound.submit"),
    pending: t("desk.lostFound.pending"),
    recorded: t("desk.lostFound.recorded"),
    refusals: refusals(t),
  };
}
