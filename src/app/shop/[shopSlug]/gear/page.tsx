import { FlashParams } from "@/components/FlashParams";
import { ShopNotice, ShopPageHeader, ShopStat } from "@/components/ShopPageHeader";
import { buttonClass } from "@/components/ui/button";
import { getDb } from "@/db/client";
import { listCurrentGearAssignments, listGearInventory, listGearServiceEvents } from "@/db/gear";
import { getShopById } from "@/db/shops";
import { requireStaffSession } from "@/lib/session";
import { AddGearForm } from "./_components/AddGearForm";
import { InventorySection } from "./_components/InventorySection";
import { PackingReturnsSection } from "./_components/PackingReturnsSection";
import { ServiceHistorySection } from "./_components/ServiceHistorySection";

const NOTICE_COPY: Record<string, string> = {
  added: "Gear added to inventory.",
  returned: "Gear returned to inventory.",
  service: "Service recorded and gear returned to the packing pool.",
  retired: "Gear retired from inventory.",
  saved: "Gear details updated.",
};

export default async function GearPage({
  searchParams,
}: {
  params: Promise<{ shopSlug: string }>;
  searchParams: Promise<{ notice?: string }>;
}) {
  const session = await requireStaffSession();
  const { notice } = await searchParams;
  const db = await getDb();
  const shop = await getShopById(db, session.user.shopId);
  if (!shop) return null;
  const [items, assignments, serviceEvents] = await Promise.all([
    listGearInventory(db, shop.id),
    listCurrentGearAssignments(db, shop.id),
    listGearServiceEvents(db, shop.id),
  ]);
  const availableCount = items.filter((item) => item.state === "available").length;
  const holdCount = items.filter((item) => item.state === "service_hold").length;
  const assignedCount = items.filter((item) => item.state === "assigned").length;
  const retiredCount = items.filter((item) => item.state === "retired").length;

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <FlashParams params={["notice"]} />
      <ShopPageHeader
        eyebrow={shop.name}
        title="Gear room"
        description="Keep equipment ready, traceable, and easy to pack. Service holds cannot be assigned; checked-out gear stays visible until it returns."
        actions={
          <a href="#add-gear" className={buttonClass({ className: "rounded-xl" })}>
            <span aria-hidden="true">+</span> Add gear
          </a>
        }
      />
      <section aria-label="Gear snapshot" className="mb-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <ShopStat label="Available" value={availableCount} detail="Ready to pack" tone="success" />
        <ShopStat
          label="Checked out"
          value={assignedCount}
          detail="Currently with divers"
          tone="primary"
        />
        <ShopStat
          label="Service hold"
          value={holdCount}
          detail="Unavailable until checked"
          tone={holdCount > 0 ? "warning" : "default"}
        />
        <ShopStat label="Retired" value={retiredCount} detail="Kept for inventory history" />
      </section>
      {notice ? (
        <ShopNotice
          tone={notice === "invalid" || notice === "service-error" ? "danger" : "success"}
        >
          {(Object.hasOwn(NOTICE_COPY, notice) && NOTICE_COPY[notice]) ||
            "Check the gear details and try again."}
        </ShopNotice>
      ) : null}
      <AddGearForm />
      <InventorySection items={items} shop={shop} />
      <ServiceHistorySection serviceEvents={serviceEvents} shop={shop} />
      <PackingReturnsSection assignments={assignments} />
    </main>
  );
}
