import Link from "next/link";
import { redirect } from "next/navigation";
import { z } from "zod";
import { FlashParams } from "@/components/FlashParams";
import { getDb } from "@/db/client";
import {
  createGearItem,
  listCurrentGearAssignments,
  listGearInventory,
  returnGear,
  setGearServiceHold,
} from "@/db/gear";
import { getShopById } from "@/db/queries";
import { requireStaffSession } from "@/lib/session";

const itemSchema = z.object({
  label: z.string().trim().min(2).max(80),
  type: z.enum(["bcd", "regulator", "wetsuit", "mask_fins", "weights", "tank"]),
  size: z.string().trim().max(40).optional(),
});

export default async function GearPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string }>;
}) {
  const session = await requireStaffSession();
  const { notice } = await searchParams;
  const db = await getDb();
  const shop = await getShopById(db, session.user.shopId);
  if (!shop) return null;
  const [items, assignments] = await Promise.all([
    listGearInventory(db, shop.id),
    listCurrentGearAssignments(db, shop.id),
  ]);

  async function addAction(formData: FormData) {
    "use server";
    const staff = await requireStaffSession();
    const parsed = itemSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) redirect("/shop/gear?notice=invalid");
    await createGearItem(await getDb(), { shopId: staff.user.shopId, ...parsed.data });
    redirect("/shop/gear?notice=added");
  }
  async function holdAction(formData: FormData) {
    "use server";
    const staff = await requireStaffSession();
    const id = String(formData.get("id") ?? "");
    const held = formData.get("held") === "true";
    await setGearServiceHold(await getDb(), staff.user.shopId, id, held);
    redirect("/shop/gear");
  }
  async function returnAction(formData: FormData) {
    "use server";
    const staff = await requireStaffSession();
    await returnGear(await getDb(), staff.user.shopId, String(formData.get("id") ?? ""));
    redirect("/shop/gear?notice=returned");
  }

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-16">
      <FlashParams params={["notice"]} />
      <Link href="/shop" className="text-sm font-medium text-primary hover:underline">
        ← Back to the shop
      </Link>
      <h1 className="mt-4 text-3xl font-semibold tracking-tight">Gear room</h1>
      <p className="mt-2 text-muted">
        Service holds cannot be assigned. Checked-out gear stays visible until it returns.
      </p>
      {notice ? (
        <p
          role="status"
          className="mt-5 rounded-lg bg-success/10 px-4 py-3 text-sm font-medium text-success"
        >
          {notice === "added"
            ? "Gear added to inventory."
            : notice === "returned"
              ? "Gear returned to inventory."
              : "Check the gear details and try again."}
        </p>
      ) : null}
      <form
        action={addAction}
        className="mt-8 grid grid-cols-1 gap-3 rounded-lg border border-border bg-surface p-5 sm:grid-cols-3"
      >
        <input
          name="label"
          required
          placeholder="BCD-12"
          className="min-h-11 rounded-lg border border-border-strong bg-surface px-3 text-base"
        />
        <select
          name="type"
          className="min-h-11 rounded-lg border border-border-strong bg-surface px-3 text-base"
        >
          {["bcd", "regulator", "wetsuit", "mask_fins", "weights", "tank"].map((type) => (
            <option key={type}>{type.replace("_", " ")}</option>
          ))}
        </select>
        <input
          name="size"
          placeholder="Size (optional)"
          className="min-h-11 rounded-lg border border-border-strong bg-surface px-3 text-base"
        />
        <button
          type="submit"
          className="min-h-11 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground sm:col-span-3"
        >
          Add inventory item
        </button>
      </form>
      <section className="mt-10">
        <h2 className="text-lg font-semibold">Inventory</h2>
        <ul className="mt-4 divide-y divide-border rounded-lg border border-border bg-surface">
          {items.map((item) => (
            <li key={item.id} className="flex items-center justify-between gap-3 px-4 py-3">
              <span>
                <strong>{item.label}</strong>{" "}
                <span className="text-sm text-muted">
                  {item.type.replace("_", " ")}
                  {item.size ? ` · ${item.size}` : ""}
                </span>
              </span>
              <div className="flex items-center gap-2">
                <span className="rounded-full bg-primary/10 px-3 py-1 text-sm font-medium text-primary">
                  {item.state.replace("_", " ")}
                </span>
                {item.state !== "assigned" && item.state !== "retired" ? (
                  <form action={holdAction}>
                    <input type="hidden" name="id" value={item.id} />
                    <input
                      type="hidden"
                      name="held"
                      value={item.state !== "service_hold" ? "true" : "false"}
                    />
                    <button
                      type="submit"
                      className="min-h-11 px-3 text-sm font-medium text-primary hover:underline"
                    >
                      {item.state === "service_hold" ? "Release hold" : "Service hold"}
                    </button>
                  </form>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      </section>
      <section className="mt-10">
        <h2 className="text-lg font-semibold">Packing & returns</h2>
        {assignments.length === 0 ? (
          <p className="mt-3 text-sm text-muted">Everything is back in the room.</p>
        ) : (
          <ul className="mt-4 divide-y divide-border rounded-lg border border-border bg-surface">
            {assignments.map(({ assignment, item, person, trip }) => (
              <li key={assignment.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <span>
                  <strong>{item.label}</strong> · {person.fullName}
                  <span className="block text-sm text-muted">{trip.title}</span>
                </span>
                <form action={returnAction}>
                  <input type="hidden" name="id" value={assignment.id} />
                  <button
                    type="submit"
                    className="min-h-11 rounded-lg border border-border px-3 text-sm font-medium hover:bg-surface-sunken"
                  >
                    Return gear
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
