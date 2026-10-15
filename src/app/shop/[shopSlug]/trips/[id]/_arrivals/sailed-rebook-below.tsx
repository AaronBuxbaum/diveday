import type { ReactNode } from "react";
import type { AppDb } from "@/db/client";
import { sailedRebooking } from "@/db/sailed-rebooking";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { formatWeekdayTime } from "@/lib/format";
import { offerAnotherDayAction } from "./actions";
import { SailedRebookLine } from "./SailedRebookLine";
import { sailedRebookCopy } from "./salvage-copy";

/**
 * Each seat's rebooking line on a finished departure's record, keyed by
 * booking id (fifth-loop ideas, item 4); `sailedRebooking` decides who gets
 * one and when, and this only words it.
 */
export async function sailedRebookBelow(input: {
  db: AppDb;
  shopId: string;
  shopSlug: string;
  tripId: string;
  now: Date;
  locale: string;
  timeZone: string;
  t: StaffTranslator;
}): Promise<Map<string, ReactNode>> {
  const { shopSlug, tripId, locale, timeZone, t } = input;
  const rows = await sailedRebooking(input.db, {
    shopId: input.shopId,
    tripId,
    now: input.now,
  });
  const offerAction = offerAnotherDayAction.bind(null, shopSlug, tripId);
  const below = new Map<string, ReactNode>();
  for (const [bookingId, row] of rows) {
    below.set(
      bookingId,
      <SailedRebookLine
        offerAction={offerAction}
        copy={sailedRebookCopy({
          t,
          next: row.next,
          shopSlug,
          diver: { id: row.personId, name: row.personName },
          formatWhen: (startsAt) => formatWeekdayTime(startsAt, locale, timeZone),
        })}
      />,
    );
  }
  return below;
}
