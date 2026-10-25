import { lostItemRowAction, recordLostItemAction } from "@/app/actions/lost-items";
import { LostItemForm } from "@/components/lost-found/LostItemForm";
import { LostItemRow } from "@/components/lost-found/LostItemRow";
import { lostItemFormCopy, lostItemRowCopy } from "@/components/lost-found/lost-found-copy";
import { SectionCard } from "@/components/ui/card";
import { getDb } from "@/db/client";
import { listTripLostItems } from "@/db/lost-items";
import type { StaffTranslator } from "@/i18n/staff-messages";

/**
 * **Left aboard** (batch 4, J2), on the Boat tab: what the crew found after
 * the departure, and the form to add to it. Drawn from "Heading in"
 * (`leftAboardOpen`), or whenever something is already recorded.
 */
export async function LostItemsSection({
  t,
  shopId,
  tripId,
  open,
  seats,
  paper = false,
}: {
  t: StaffTranslator;
  shopId: string;
  tripId: string;
  /** The crew is heading in, or the departure is back (`leftAboardOpen`). */
  open: boolean;
  seats: { bookingId: string; name: string }[];
  /** The packet's paper: the items found, read-only, and nothing when none were. */
  paper?: boolean;
}) {
  const items = await listTripLostItems(await getDb(), shopId, tripId);
  if (paper ? items.length === 0 : !open && items.length === 0) return null;
  const rowAction = lostItemRowAction.bind(null, tripId);
  const rowCopy = lostItemRowCopy(t);
  return (
    <SectionCard
      id="found-aboard"
      className="scroll-mt-24"
      title={t("desk.lostFound.heading")}
      description={t("desk.lostFound.lead")}
    >
      {items.length > 0 ? (
        <ul className="mb-4 divide-y divide-border">
          {items.map((item) => (
            <LostItemRow
              key={item.id}
              item={item}
              action={rowAction}
              copy={rowCopy}
              paper={paper}
            />
          ))}
        </ul>
      ) : null}
      {paper ? null : (
        <LostItemForm
          action={recordLostItemAction.bind(null, tripId)}
          seats={seats}
          copy={lostItemFormCopy(t)}
        />
      )}
    </SectionCard>
  );
}
