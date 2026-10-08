import type { ComponentProps } from "react";
import { getDb } from "@/db/client";
import { serviceReminderStates } from "@/db/work-order-follow-up";
import { customerGearDueDates } from "@/lib/work-order-follow-up";
import { WorkOrdersGroup } from "./WorkOrdersGroup";

type GroupProps = ComponentProps<typeof WorkOrdersGroup>;

/**
 * The diver's own gear group, with each piece's service-reminder switch read
 * in (ADR 20261008-work-order-follow-up). Only a piece with a due date has a
 * reminder to switch off, so only those are read.
 *
 * Its own read rather than one more line in the record's page, which is held
 * to its length; the shop comes from the session the page already resolved.
 */
export async function DiverWorkOrdersGroup({
  shop,
  ...props
}: Omit<GroupProps, "shopSlug" | "timezone" | "reminders"> & {
  shop: { id: string; slug: string; timezone: string };
}) {
  const reminders = await serviceReminderStates(
    await getDb(),
    shop.id,
    props.pieces.filter((piece) => customerGearDueDates(piece).length > 0).map((piece) => piece.id),
  );
  return (
    <WorkOrdersGroup
      {...props}
      shopSlug={shop.slug}
      timezone={shop.timezone}
      reminders={reminders}
    />
  );
}
